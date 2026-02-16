import http from "http";

const BASE = "http://localhost:5000";
let cookie = "";

async function httpReq(method: string, path: string, body?: any): Promise<{ ms: number; status: number; data: any }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    };
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        const sc = res.headers["set-cookie"];
        if (sc) cookie = sc.map((c) => c.split(";")[0]).join("; ");
        let parsed: any;
        try { parsed = JSON.parse(d); } catch { parsed = d; }
        resolve({ ms: Date.now() - t0, status: res.statusCode || 0, data: parsed });
      });
    });
    r.on("error", () => resolve({ ms: Date.now() - t0, status: 0, data: null }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  await httpReq("POST", "/api/auth/login", { username: "marcelo", password: "1234" });

  const tables = (await httpReq("GET", "/api/admin/tables")).data;
  const products = (await httpReq("GET", "/api/waiter/menu")).data;
  const pmethods = (await httpReq("GET", "/api/pos/payment-methods")).data;

  const freeTable = tables.find((t: any) => t.active);
  const prod = products.find((p: any) => p.active);
  const pm = pmethods[0];

  await httpReq("POST", "/api/pos/cash-session/open", { openingAmount: 100000 });

  console.log("\nWRITE OPERATIONS LATENCY (ms) - 5 runs each");
  console.log("=".repeat(70));

  const ops: { name: string; times: number[] }[] = [];

  for (let i = 0; i < 5; i++) {
    const t2 = tables[(i + 1) % tables.length];
    const sendR = await httpReq("POST", `/api/waiter/tables/${t2.id}/send-round`, {
      items: [
        { productId: prod.id, qty: 1, notes: `perf-${i}-a` },
        { productId: prod.id, qty: 2, notes: `perf-${i}-b` },
        { productId: prod.id, qty: 1, notes: `perf-${i}-c` },
      ],
    });
    const existing = ops.find((o) => o.name === "send-round (3 items)");
    if (existing) existing.times.push(sendR.ms);
    else ops.push({ name: "send-round (3 items)", times: [sendR.ms] });

    if (sendR.data?.orderId) {
      const orderR = await httpReq("GET", `/api/pos/orders/${sendR.data.orderId}`);
      const existing2 = ops.find((o) => o.name === "GET /pos/orders/:id");
      if (existing2) existing2.times.push(orderR.ms);
      else ops.push({ name: "GET /pos/orders/:id", times: [orderR.ms] });

      const addR = await httpReq("POST", `/api/pos/orders/${sendR.data.orderId}/add-items`, {
        items: [{ productId: prod.id, qty: 1, notes: `add-${i}` }],
      });
      const existing3 = ops.find((o) => o.name === "add-items (1 item)");
      if (existing3) existing3.times.push(addR.ms);
      else ops.push({ name: "add-items (1 item)", times: [addR.ms] });

      const freshOrder = await httpReq("GET", `/api/pos/orders/${sendR.data.orderId}`);
      const balance = freshOrder.data?.balanceDue || freshOrder.data?.total || 5000;

      const payR = await httpReq("POST", `/api/pos/orders/${sendR.data.orderId}/pay`, {
        paymentMethodId: pm.id,
        amount: Number(balance),
        reference: `PERF-${i}`,
      });
      const existing4 = ops.find((o) => o.name === "pay order");
      if (existing4) existing4.times.push(payR.ms);
      else ops.push({ name: "pay order", times: [payR.ms] });
    }
  }

  const kdsR = await httpReq("GET", "/api/kds/tickets/KITCHEN");
  if (kdsR.data?.length > 0 && kdsR.data[0].items?.length > 0) {
    for (let i = 0; i < Math.min(5, kdsR.data[0].items.length); i++) {
      const itemId = kdsR.data[0].items[i].id;
      const upd = await httpReq("PATCH", `/api/kds/items/${itemId}`, { status: "DONE" });
      const existing = ops.find((o) => o.name === "KDS update item");
      if (existing) existing.times.push(upd.ms);
      else ops.push({ name: "KDS update item", times: [upd.ms] });
    }
  }

  console.log("  Avg  Min  Max  Operation");
  console.log("-".repeat(70));
  ops.sort((a, b) => {
    const avgA = a.times.reduce((s, t) => s + t, 0) / a.times.length;
    const avgB = b.times.reduce((s, t) => s + t, 0) / b.times.length;
    return avgB - avgA;
  });

  for (const op of ops) {
    const avg = Math.round(op.times.reduce((a, b) => a + b, 0) / op.times.length);
    const min = Math.min(...op.times);
    const max = Math.max(...op.times);
    const flag = avg > 100 ? " *** SLOW" : avg > 50 ? " * WARN" : "";
    console.log(
      String(avg).padStart(5) +
        String(min).padStart(5) +
        String(max).padStart(5) +
        "  " +
        op.name +
        flag
    );
  }

  console.log("\n--- CONCURRENT WRITE TEST (5 send-rounds simultaneously) ---");
  const concurrentPromises = [];
  for (let i = 0; i < 5; i++) {
    const t = tables[i % tables.length];
    concurrentPromises.push(
      httpReq("POST", `/api/waiter/tables/${t.id}/send-round`, {
        items: [
          { productId: prod.id, qty: 1, notes: `conc-${i}-a` },
          { productId: prod.id, qty: 1, notes: `conc-${i}-b` },
        ],
      })
    );
  }
  const concResults = await Promise.all(concurrentPromises);
  const concTimes = concResults.map((r) => r.ms);
  const concAvg = Math.round(concTimes.reduce((a, b) => a + b, 0) / concTimes.length);
  console.log(`  Individual: ${concTimes.join("ms, ")}ms`);
  console.log(`  Avg: ${concAvg}ms  Max: ${Math.max(...concTimes)}ms`);

  console.log("\n--- CONCURRENT READ+WRITE MIX (simulates real restaurant) ---");
  const mixPromises = [
    httpReq("GET", "/api/waiter/tables"),
    httpReq("GET", "/api/kds/tickets/KITCHEN"),
    httpReq("GET", "/api/pos/tables"),
    httpReq("POST", `/api/waiter/tables/${freeTable.id}/send-round`, {
      items: [{ productId: prod.id, qty: 1, notes: "mix-write" }],
    }),
    httpReq("GET", "/api/dashboard"),
  ];
  const mixResults = await Promise.all(mixPromises);
  console.log("  Latencies:");
  const labels = ["waiter/tables", "kds/tickets", "pos/tables", "send-round", "dashboard"];
  mixResults.forEach((r, i) => {
    const flag = r.ms > 100 ? " *** SLOW" : r.ms > 50 ? " * WARN" : "";
    console.log(`    ${labels[i]}: ${r.ms}ms${flag}`);
  });
}

main().catch(console.error);
