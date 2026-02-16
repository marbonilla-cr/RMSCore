import http from "http";

const BASE = "http://localhost:5000";
const CONCURRENT_ORDERS = 25;
const startTime = Date.now();

let managerCookie = "";
let tables: any[] = [];
let products: any[] = [];
let paymentMethodId: number;
let cashSessionId: number;

let totalRequests = 0;
let failedRequests = 0;
let successRequests = 0;
const latencies: number[] = [];
const errors: string[] = [];

async function httpReq(method: string, path: string, body?: any, cookieOverride?: string): Promise<{ status: number; data: any; cookie: string; latency: number }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const useCookie = cookieOverride ?? managerCookie;
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...(useCookie ? { Cookie: useCookie } : {}),
      },
    };

    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const latency = Date.now() - t0;
        latencies.push(latency);
        totalRequests++;

        let setCookieStr = "";
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
          setCookieStr = setCookie.map((c) => c.split(";")[0]).join("; ");
        }

        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }

        if (res.statusCode && res.statusCode >= 400) {
          failedRequests++;
          errors.push(`${method} ${path} -> ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 100)}`);
        } else {
          successRequests++;
        }

        resolve({ status: res.statusCode || 0, data: parsed, cookie: setCookieStr || useCookie, latency });
      });
    });

    r.on("error", (err) => {
      totalRequests++;
      failedRequests++;
      errors.push(`${method} ${path} -> NETWORK ERROR: ${err.message}`);
      resolve({ status: 0, data: null, cookie: "", latency: Date.now() - t0 });
    });

    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function setup() {
  console.log("Setting up stress test...\n");

  const login = await httpReq("POST", "/api/auth/login", { username: "marcelo", password: "1234" });
  if (login.status !== 200) {
    console.error("Cannot login as manager. Aborting.");
    process.exit(1);
  }
  managerCookie = login.cookie;
  console.log("  Logged in as manager");

  const tablesR = await httpReq("GET", "/api/admin/tables");
  tables = (tablesR.data || []).filter((t: any) => t.active);
  console.log(`  Found ${tables.length} active tables`);

  const productsR = await httpReq("GET", "/api/waiter/menu");
  products = (productsR.data || []).filter((p: any) => p.active);
  console.log(`  Found ${products.length} active products`);

  const pmR = await httpReq("GET", "/api/pos/payment-methods");
  if (pmR.data?.length > 0) paymentMethodId = pmR.data[0].id;
  console.log(`  Payment method ID: ${paymentMethodId}`);

  const csR = await httpReq("POST", "/api/pos/cash-session/open", { openingAmount: 100000 });
  if (csR.data?.id) {
    cashSessionId = csR.data.id;
  } else {
    const activeR = await httpReq("GET", "/api/pos/cash-session/active");
    if (activeR.data?.id) cashSessionId = activeR.data.id;
  }
  console.log(`  Cash session ID: ${cashSessionId}`);

  totalRequests = 0;
  failedRequests = 0;
  successRequests = 0;
  latencies.length = 0;
  errors.length = 0;
}

function randomProducts(count: number) {
  const items: any[] = [];
  for (let i = 0; i < count; i++) {
    const p = products[Math.floor(Math.random() * products.length)];
    items.push({
      productId: p.id,
      qty: Math.floor(Math.random() * 3) + 1,
      notes: `stress-item-${i}`,
    });
  }
  return items;
}

async function simulateOrderLifecycle(index: number): Promise<{ orderId: number | null; success: boolean; steps: string[] }> {
  const steps: string[] = [];
  const tableIdx = index % tables.length;
  const table = tables[tableIdx];

  const itemCount = Math.floor(Math.random() * 4) + 2;
  const items = randomProducts(itemCount);
  const sendR = await httpReq("POST", `/api/waiter/tables/${table.id}/send-round`, { items });

  if (sendR.status !== 200 && sendR.status !== 201) {
    steps.push(`FAIL: send-round (${sendR.status})`);
    return { orderId: null, success: false, steps };
  }

  const orderId = sendR.data?.orderId;
  steps.push(`created order #${orderId} with ${itemCount} items`);

  const orderR = await httpReq("GET", `/api/pos/orders/${orderId}`);
  if (orderR.status === 200) {
    steps.push(`fetched order details`);
  }

  const kdsR = await httpReq("GET", "/api/kds/tickets/KITCHEN");
  if (kdsR.status === 200 && kdsR.data?.length > 0) {
    const ticket = kdsR.data.find((t: any) => t.orderId === orderId);
    if (ticket?.items?.length > 0) {
      for (const item of ticket.items.slice(0, 2)) {
        await httpReq("PATCH", `/api/kds/items/${item.id}`, { status: "IN_PROGRESS" });
      }
      for (const item of ticket.items) {
        await httpReq("PATCH", `/api/kds/items/${item.id}`, { status: "DONE" });
      }
      steps.push(`processed ${ticket.items.length} KDS items`);
    }
  }

  if (orderId && Math.random() < 0.3) {
    const addItems = randomProducts(1);
    const addR = await httpReq("POST", `/api/pos/orders/${orderId}/add-items`, { items: addItems });
    if (addR.status === 200 || addR.status === 201) {
      steps.push(`added extra items from POS`);
    }
  }

  if (cashSessionId && paymentMethodId && orderId) {
    const freshOrder = await httpReq("GET", `/api/pos/orders/${orderId}`);
    const balance = freshOrder.data?.balanceDue || freshOrder.data?.total || 10000;
    const payR = await httpReq("POST", `/api/pos/orders/${orderId}/pay`, {
      paymentMethodId,
      amount: Number(balance),
      reference: `STRESS-${index}`,
    });
    if (payR.status === 200 || payR.status === 201) {
      steps.push(`paid ₡${Number(balance).toLocaleString()}`);
    } else {
      steps.push(`FAIL: payment (${payR.status})`);
    }
  }

  return { orderId, success: true, steps };
}

async function runStressTest() {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  STRESS TEST: ${CONCURRENT_ORDERS} concurrent order lifecycles`);
  console.log(`${"═".repeat(50)}\n`);

  const batchSize = 5;
  type OrderResult = { orderId: number | null; success: boolean; steps: string[] };
  const results: OrderResult[] = [];

  for (let batch = 0; batch < Math.ceil(CONCURRENT_ORDERS / batchSize); batch++) {
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, CONCURRENT_ORDERS);
    const promises: Promise<OrderResult>[] = [];

    for (let i = start; i < end; i++) {
      promises.push(simulateOrderLifecycle(i));
    }

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    console.log(`  Batch ${batch + 1}: ${batchResults.filter(r => r.success).length}/${batchResults.length} successful`);
  }

  const successful = results.filter(r => r.success).length;

  console.log(`\n${"─".repeat(50)}`);
  console.log("  ORDER LIFECYCLE RESULTS:");
  console.log(`${"─".repeat(50)}`);
  results.forEach((r, i) => {
    const status = r.success ? "OK" : "FAIL";
    console.log(`  [${String(i + 1).padStart(2)}] ${status} - ${r.steps.join(" -> ")}`);
  });

  console.log(`\n${"─".repeat(50)}`);
  console.log("  CONCURRENT READ TEST:");
  console.log(`${"─".repeat(50)}`);

  const readPromises = [
    httpReq("GET", "/api/waiter/tables"),
    httpReq("GET", "/api/pos/tables"),
    httpReq("GET", "/api/kds/tickets/KITCHEN"),
    httpReq("GET", "/api/kds/tickets/BAR"),
    httpReq("GET", "/api/waiter/menu"),
    httpReq("GET", "/api/waiter/categories"),
    httpReq("GET", "/api/pos/payment-methods"),
    httpReq("GET", "/api/pos/paid-orders"),
    httpReq("GET", "/api/dashboard"),
    httpReq("GET", "/api/inventory/items"),
    httpReq("GET", "/api/inventory/reports/valuation"),
    httpReq("GET", "/api/inventory/reports/low-stock"),
    httpReq("GET", "/api/shortages/active"),
    httpReq("GET", "/api/hr/team-clock-status"),
    httpReq("GET", "/api/admin/employees"),
  ];

  const readResults = await Promise.all(readPromises);
  const readSuccess = readResults.filter(r => r.status === 200).length;
  const readFail = readResults.filter(r => r.status !== 200).length;
  console.log(`  ${readSuccess}/${readResults.length} concurrent reads succeeded (${readFail} failed)`);

  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const avgLatency = sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length;
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
  const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
  const maxLatency = sortedLatencies[sortedLatencies.length - 1];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(50)}`);
  console.log("  STRESS TEST SUMMARY");
  console.log(`${"═".repeat(50)}`);
  console.log(`  Orders attempted:     ${CONCURRENT_ORDERS}`);
  console.log(`  Orders successful:    ${successful}/${CONCURRENT_ORDERS} (${((successful / CONCURRENT_ORDERS) * 100).toFixed(0)}%)`);
  console.log(`  Total HTTP requests:  ${totalRequests}`);
  console.log(`  Successful requests:  ${successRequests}`);
  console.log(`  Failed requests:      ${failedRequests}`);
  console.log(`  Avg latency:          ${avgLatency.toFixed(0)}ms`);
  console.log(`  P50 latency:          ${p50}ms`);
  console.log(`  P95 latency:          ${p95}ms`);
  console.log(`  P99 latency:          ${p99}ms`);
  console.log(`  Max latency:          ${maxLatency}ms`);
  console.log(`  Total time:           ${elapsed}s`);
  console.log(`  Throughput:           ${(totalRequests / parseFloat(elapsed)).toFixed(1)} req/s`);
  console.log(`${"═".repeat(50)}`);

  if (errors.length > 0) {
    console.log(`\n  ERRORS (${errors.length}):`);
    const uniqueErrors = [...new Set(errors)];
    uniqueErrors.slice(0, 20).forEach(e => console.log(`    - ${e}`));
    if (uniqueErrors.length > 20) console.log(`    ... and ${uniqueErrors.length - 20} more`);
  }

  const failRate = failedRequests / totalRequests;
  if (failRate > 0.05) {
    console.log(`\n  VERDICT: FAIL (${(failRate * 100).toFixed(1)}% error rate > 5% threshold)`);
    process.exit(1);
  } else {
    console.log(`\n  VERDICT: PASS (${(failRate * 100).toFixed(1)}% error rate)`);
    process.exit(0);
  }
}

setup().then(runStressTest).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
