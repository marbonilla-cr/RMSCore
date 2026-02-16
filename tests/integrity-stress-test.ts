import http from "http";

const BASE = "http://localhost:5000";
const ORDERS_PER_TABLE = 50;
const MAX_ROUNDS = 15;
const ITEMS_PER_ROUND_MIN = 1;
const ITEMS_PER_ROUND_MAX = 4;

interface Session { cookie: string; role: string; username: string; userId?: number }

const waiterSession: Session = { cookie: "", role: "WAITER", username: "salonero1" };
const kitchenSession: Session = { cookie: "", role: "KITCHEN", username: "cocina" };
const cashierSession: Session = { cookie: "", role: "CASHIER", username: "cajero" };
const managerSession: Session = { cookie: "", role: "MANAGER", username: "marcelo" };

let tables: any[] = [];
let kitchenProducts: any[] = [];
let barProducts: any[] = [];
let allProducts: any[] = [];
let paymentMethods: any[] = [];
let cashPaymentMethodId: number;

const timings: Record<string, number[]> = {
  "waiter:send-round": [],
  "kitchen:get-tickets": [],
  "kitchen:update-item": [],
  "kitchen:update-ticket": [],
  "cashier:open-cash": [],
  "cashier:pay-order": [],
  "cashier:close-cash": [],
  "cashier:get-session": [],
  "manager:dashboard": [],
  "waiter:get-tables": [],
};

interface OrderRecord {
  tableId: number;
  tableName: string;
  orderId: number;
  itemsSent: { productId: number; productName: string; qty: number; kdsDestination: string; price: number; round: number }[];
  totalExpected: number;
  ticketIds: number[];
}

const orderRecords: OrderRecord[] = [];
let totalLinesSentKitchen = 0;
let totalLinesSentBar = 0;
let totalQtySentKitchen = 0;
let totalQtySentBar = 0;
let totalKdsItemsFoundKitchen = 0;
let totalKdsItemsFoundBar = 0;

let integrityErrors: string[] = [];
let integrityPassed = 0;

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function httpReq(
  method: string,
  path: string,
  session: Session,
  body?: any
): Promise<{ status: number; data: any; latency: number }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
    };

    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const latency = Date.now() - t0;
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
          session.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
        }
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, data: parsed, latency });
      });
    });

    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function recordTiming(key: string, ms: number) {
  if (timings[key]) timings[key].push(ms);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function checkIntegrity(condition: boolean, msg: string) {
  if (condition) {
    integrityPassed++;
  } else {
    integrityErrors.push(msg);
  }
}

async function login(session: Session, password: string = "1234") {
  const r = await httpReq("POST", "/api/auth/login", session, { username: session.username, password });
  if (r.status !== 200) {
    console.error(`  FATAL: Cannot login as ${session.username} (${session.role}). Status: ${r.status}`);
    process.exit(1);
  }
  session.userId = r.data?.user?.id;
  console.log(`  Logged in as ${session.username} (${session.role}) - userId: ${session.userId}`);
}

async function logout(session: Session) {
  await httpReq("POST", "/api/auth/logout", session);
  session.cookie = "";
}

async function setup() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  INTEGRITY + PERFORMANCE STRESS TEST");
  console.log("  3 Roles: Mesero, Cocinero, Cajero");
  console.log("══════════════════════════════════════════════════\n");

  console.log("── SETUP ──────────────────────────────────────\n");

  await login(managerSession);
  await login(waiterSession);
  await login(kitchenSession);
  await login(cashierSession);

  const cleanR = await httpReq("POST", "/api/admin/truncate-transactions", managerSession);
  if (cleanR.status === 200) {
    console.log("  Cleaned transactional data");
  } else {
    console.log("  Warning: Could not clean transactions:", cleanR.data?.message);
  }

  const existingCs = await httpReq("GET", "/api/pos/cash-session", cashierSession);
  if (existingCs.data?.id && !existingCs.data.closedAt) {
    await httpReq("POST", "/api/pos/cash-session/close", cashierSession, { countedCash: "0", notes: "auto-close for test" });
    console.log("  Closed existing cash session");
  }

  const tablesR = await httpReq("GET", "/api/admin/tables", managerSession);
  tables = (tablesR.data || []).filter((t: any) => t.active && !t.tableName.startsWith("_TEST"));
  console.log(`  Active tables: ${tables.length}`);

  const menuR = await httpReq("GET", "/api/waiter/menu", waiterSession);
  allProducts = (menuR.data || []).filter((p: any) => p.active);

  const catsR = await httpReq("GET", "/api/admin/categories", managerSession);
  const cats = catsR.data || [];
  const catDestMap = new Map<number, string>();
  for (const c of cats) catDestMap.set(c.id, c.kdsDestination || "cocina");

  kitchenProducts = allProducts.filter(p => catDestMap.get(p.categoryId) === "cocina");
  barProducts = allProducts.filter(p => catDestMap.get(p.categoryId) === "bar");

  console.log(`  Products: ${allProducts.length} total (${kitchenProducts.length} cocina, ${barProducts.length} bar)`);

  const pmR = await httpReq("GET", "/api/pos/payment-methods", cashierSession);
  paymentMethods = (pmR.data || []).filter((m: any) => m.active);
  const cashPm = paymentMethods.find(m => m.paymentCode === "CASH");
  cashPaymentMethodId = cashPm?.id || paymentMethods[0]?.id;
  console.log(`  Payment methods: ${paymentMethods.length} (cash ID: ${cashPaymentMethodId})`);

  if (tables.length === 0 || allProducts.length === 0 || paymentMethods.length === 0) {
    console.error("  FATAL: Missing tables, products, or payment methods. Aborting.");
    process.exit(1);
  }
}

async function phaseWaiterSendOrders() {
  console.log("\n── PHASE 1: MESERO - Enviar órdenes ─────────────\n");
  const totalOrders = Math.min(ORDERS_PER_TABLE, tables.length);
  const t0 = Date.now();
  let roundsSent = 0;
  let itemsSent = 0;

  for (let i = 0; i < totalOrders; i++) {
    const table = tables[i % tables.length];
    const numRounds = randomInt(1, MAX_ROUNDS);
    const record: OrderRecord = {
      tableId: table.id,
      tableName: table.tableName,
      orderId: 0,
      itemsSent: [],
      totalExpected: 0,
      ticketIds: [],
    };

    for (let r = 0; r < numRounds; r++) {
      const numItems = randomInt(ITEMS_PER_ROUND_MIN, ITEMS_PER_ROUND_MAX);
      const items: any[] = [];

      for (let j = 0; j < numItems; j++) {
        const useBar = Math.random() < 0.4;
        const pool = useBar ? barProducts : kitchenProducts;
        if (pool.length === 0) continue;
        const product = pick(pool);
        const qty = randomInt(1, 3);
        const dest = useBar ? "bar" : "cocina";
        items.push({ productId: product.id, qty, notes: `test-r${r + 1}` });
        record.itemsSent.push({
          productId: product.id,
          productName: product.name,
          qty,
          kdsDestination: dest,
          price: Number(product.price),
          round: r + 1,
        });
        if (dest === "cocina") { totalLinesSentKitchen++; totalQtySentKitchen += qty; }
        else { totalLinesSentBar++; totalQtySentBar += qty; }
      }

      if (items.length === 0) continue;

      const resp = await httpReq("POST", `/api/waiter/tables/${table.id}/send-round`, waiterSession, { items });
      recordTiming("waiter:send-round", resp.latency);

      if (resp.status === 200 && resp.data?.ok) {
        if (resp.data.ticketIds) record.ticketIds.push(...resp.data.ticketIds);
        roundsSent++;
        itemsSent += items.reduce((s, it) => s + it.qty, 0);
      } else {
        integrityErrors.push(`send-round failed table=${table.tableName} round=${r + 1}: status=${resp.status} ${JSON.stringify(resp.data).slice(0, 200)}`);
      }
    }

    const tablesR = await httpReq("GET", "/api/waiter/tables", waiterSession);
    recordTiming("waiter:get-tables", tablesR.latency);
    const tableData = (tablesR.data || []).find((t: any) => t.id === table.id);
    if (tableData?.orderId) {
      record.orderId = tableData.orderId;
    }

    orderRecords.push(record);

    if ((i + 1) % 10 === 0 || i === totalOrders - 1) {
      console.log(`  [${i + 1}/${totalOrders}] Órdenes enviadas | ${roundsSent} rondas | ${itemsSent} items`);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(`\n  Total: ${totalOrders} órdenes, ${roundsSent} rondas, ${itemsSent} items en ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  Cocina: ${totalLinesSentKitchen} líneas (${totalQtySentKitchen} qty) | Bar: ${totalLinesSentBar} líneas (${totalQtySentBar} qty)`);
}

async function phaseKitchenProcess() {
  console.log("\n── PHASE 2: COCINERO - Procesar tickets KDS ─────\n");

  for (const dest of ["cocina", "bar"]) {
    const ticketsR = await httpReq("GET", `/api/kds/tickets/active?destination=${dest}`, kitchenSession);
    recordTiming("kitchen:get-tickets", ticketsR.latency);

    if (ticketsR.status !== 200) {
      integrityErrors.push(`KDS get-tickets ${dest} failed: ${ticketsR.status}`);
      continue;
    }

    const tickets = ticketsR.data || [];
    let itemCount = 0;
    let ticketCount = 0;

    for (const ticket of tickets) {
      const ticketItems = ticket.items || [];

      for (const item of ticketItems) {
        if (item.status === "NEW") {
          const prepR = await httpReq("PATCH", `/api/kds/items/${item.id}`, kitchenSession, { status: "PREPARING" });
          recordTiming("kitchen:update-item", prepR.latency);
        }
      }

      for (const item of ticketItems) {
        if (item.status !== "READY") {
          const readyR = await httpReq("PATCH", `/api/kds/items/${item.id}`, kitchenSession, { status: "READY" });
          recordTiming("kitchen:update-item", readyR.latency);
          itemCount++;
        }
      }

      const completeR = await httpReq("PATCH", `/api/kds/tickets/${ticket.id}`, kitchenSession, { status: "READY" });
      recordTiming("kitchen:update-ticket", completeR.latency);
      ticketCount++;
    }

    if (dest === "cocina") totalKdsItemsFoundKitchen = itemCount;
    else totalKdsItemsFoundBar = itemCount;

    console.log(`  ${dest.toUpperCase()}: ${ticketCount} tickets, ${itemCount} items procesados`);
  }

  const histKitchenR = await httpReq("GET", "/api/kds/tickets/active?destination=cocina", kitchenSession);
  const histBarR = await httpReq("GET", "/api/kds/tickets/active?destination=bar", kitchenSession);
  const remainingKitchen = (histKitchenR.data || []).length;
  const remainingBar = (histBarR.data || []).length;
  console.log(`  Tickets pendientes restantes - cocina: ${remainingKitchen}, bar: ${remainingBar}`);
  checkIntegrity(remainingKitchen === 0, `No remaining kitchen tickets (found ${remainingKitchen})`);
  checkIntegrity(remainingBar === 0, `No remaining bar tickets (found ${remainingBar})`);
}

async function phaseCashierPayments() {
  console.log("\n── PHASE 3: CAJERO - Abrir caja y pagar órdenes ─\n");

  const openR = await httpReq("POST", "/api/pos/cash-session/open", cashierSession, { openingCash: "50000" });
  recordTiming("cashier:open-cash", openR.latency);

  if (openR.status !== 200) {
    integrityErrors.push(`Cash session open failed: ${openR.status} ${JSON.stringify(openR.data).slice(0, 200)}`);
    return;
  }
  console.log(`  Caja abierta (ID: ${openR.data?.id})`);

  let paidCount = 0;
  let totalPaid = 0;
  let paymentErrors = 0;

  const posTablesR = await httpReq("GET", "/api/pos/tables", cashierSession);
  const posTables = posTablesR.data || [];

  for (const record of orderRecords) {
    if (!record.orderId) {
      const posTable = posTables.find((t: any) => t.id === record.tableId);
      if (posTable?.orderId) record.orderId = posTable.orderId;
    }

    if (!record.orderId) {
      integrityErrors.push(`No orderId found for table ${record.tableName}`);
      continue;
    }

    const orderR = await httpReq("GET", `/api/dashboard/orders/${record.orderId}`, managerSession);
    if (orderR.status !== 200 || !orderR.data) {
      integrityErrors.push(`Cannot get order ${record.orderId}: ${orderR.status}`);
      continue;
    }

    const orderTotal = Number(orderR.data.totalAmount || 0);
    const balanceDue = Number(orderR.data.balanceDue || orderTotal);
    record.totalExpected = orderTotal;

    if (balanceDue <= 0) {
      continue;
    }

    const pmId = paymentMethods.length > 1 ? paymentMethods[randomInt(0, paymentMethods.length - 1)].id : cashPaymentMethodId;

    const payR = await httpReq("POST", "/api/pos/pay", cashierSession, {
      orderId: record.orderId,
      paymentMethodId: pmId,
      amount: balanceDue,
    });
    recordTiming("cashier:pay-order", payR.latency);

    if (payR.status === 200) {
      paidCount++;
      totalPaid += balanceDue;
    } else {
      paymentErrors++;
      integrityErrors.push(`Payment failed order=${record.orderId} table=${record.tableName}: ${payR.status} ${JSON.stringify(payR.data).slice(0, 200)}`);
    }
  }

  console.log(`  Pagadas: ${paidCount}/${orderRecords.length} órdenes`);
  console.log(`  Total pagado: ₡${totalPaid.toFixed(2)}`);
  if (paymentErrors > 0) console.log(`  Errores de pago: ${paymentErrors}`);

  const sessionR = await httpReq("GET", "/api/pos/cash-session", cashierSession);
  recordTiming("cashier:get-session", sessionR.latency);

  const closeR = await httpReq("POST", "/api/pos/cash-session/close", cashierSession, {
    countedCash: String(50000 + totalPaid),
    notes: "Cierre stress test",
  });
  recordTiming("cashier:close-cash", closeR.latency);

  if (closeR.status === 200) {
    console.log(`  Caja cerrada exitosamente`);
    const closedData = closeR.data;
    if (closedData.totalsByMethod && Array.isArray(closedData.totalsByMethod)) {
      console.log(`  Totales por método:`);
      for (const m of closedData.totalsByMethod) {
        console.log(`    ${m.paymentName}: ₡${Number(m.total || 0).toFixed(2)} (${m.count} transacciones)`);
      }
    }
  } else {
    integrityErrors.push(`Cash close failed: ${closeR.status} ${JSON.stringify(closeR.data).slice(0, 200)}`);
  }

  return { totalPaid, paidCount };
}

async function phaseDashboardVerification(paymentData: { totalPaid: number; paidCount: number } | undefined) {
  console.log("\n── PHASE 4: MANAGER - Verificar Dashboard ───────\n");

  const dashR = await httpReq("GET", "/api/dashboard", managerSession);
  recordTiming("manager:dashboard", dashR.latency);

  if (dashR.status !== 200) {
    integrityErrors.push(`Dashboard failed: ${dashR.status}`);
    return;
  }

  const dash = dashR.data;
  const openCount = dash.openOrders?.count || 0;
  const paidCount = dash.paidOrders?.count || 0;
  const paidAmount = dash.paidOrders?.amount || 0;
  console.log(`  Dashboard data:`);
  console.log(`    Órdenes activas: ${openCount}`);
  console.log(`    Órdenes pagadas: ${paidCount}`);
  console.log(`    Total ventas pagadas: ₡${Number(paidAmount).toFixed(2)}`);

  if (dash.paymentMethodTotals && Array.isArray(dash.paymentMethodTotals)) {
    console.log(`    Desglose por método:`);
    for (const m of dash.paymentMethodTotals) {
      console.log(`      ${m.paymentName || m.payment_name}: ₡${Number(m.total || 0).toFixed(2)} (${m.count} txns)`);
    }
  }

  if (paymentData) {
    const dashRevenue = Number(paidAmount);
    const diff = Math.abs(dashRevenue - paymentData.totalPaid);
    checkIntegrity(diff < 1, `Dashboard revenue (₡${dashRevenue.toFixed(2)}) matches total paid (₡${paymentData.totalPaid.toFixed(2)}) - diff: ₡${diff.toFixed(2)}`);

    checkIntegrity(paidCount === paymentData.paidCount, `Dashboard paid orders (${paidCount}) matches payment count (${paymentData.paidCount})`);

    if (dash.paymentMethodTotals && Array.isArray(dash.paymentMethodTotals)) {
      const dashPaymentSum = dash.paymentMethodTotals.reduce((s: number, m: any) => s + Number(m.total || 0), 0);
      const payDiff = Math.abs(dashPaymentSum - paymentData.totalPaid);
      checkIntegrity(payDiff < 1, `Dashboard payment method sum (₡${dashPaymentSum.toFixed(2)}) matches total paid (₡${paymentData.totalPaid.toFixed(2)}) - diff: ₡${payDiff.toFixed(2)}`);
    }
  }
}

async function phaseIntegrityChecks() {
  console.log("\n── PHASE 5: VERIFICACIÓN DE INTEGRIDAD ──────────\n");

  console.log("  1. KDS Completeness:");
  console.log(`     Líneas enviadas cocina: ${totalLinesSentKitchen} (qty total: ${totalQtySentKitchen})`);
  console.log(`     Líneas KDS cocina:      ${totalKdsItemsFoundKitchen}`);
  console.log(`     Líneas enviadas bar:    ${totalLinesSentBar} (qty total: ${totalQtySentBar})`);
  console.log(`     Líneas KDS bar:         ${totalKdsItemsFoundBar}`);

  checkIntegrity(
    totalKdsItemsFoundKitchen === totalLinesSentKitchen,
    `KDS cocina lines (${totalKdsItemsFoundKitchen}) === lines sent (${totalLinesSentKitchen})`
  );
  checkIntegrity(
    totalKdsItemsFoundBar === totalLinesSentBar,
    `KDS bar lines (${totalKdsItemsFoundBar}) === lines sent (${totalLinesSentBar})`
  );

  console.log("\n  2. Order Totals:");
  let ordersWithZeroTotal = 0;
  let ordersChecked = 0;

  for (const record of orderRecords) {
    if (!record.orderId) continue;
    const orderR = await httpReq("GET", `/api/dashboard/orders/${record.orderId}`, managerSession);
    if (orderR.status !== 200) continue;
    ordersChecked++;

    const total = Number(orderR.data.totalAmount || 0);
    if (total === 0 && record.itemsSent.length > 0) {
      ordersWithZeroTotal++;
      integrityErrors.push(`Order ${record.orderId} (${record.tableName}) has $0 total but ${record.itemsSent.length} items sent`);
    }

    const balanceDue = Number(orderR.data.balanceDue || 0);
    const paidAmount = Number(orderR.data.paidAmount || 0);
    const status = orderR.data.status;

    if (status === "PAID") {
      checkIntegrity(balanceDue <= 0.01, `Paid order ${record.orderId} has balanceDue=₡${balanceDue.toFixed(2)} (should be 0)`);
      checkIntegrity(Math.abs(paidAmount - total) < 0.02, `Paid order ${record.orderId} paidAmount (₡${paidAmount.toFixed(2)}) matches total (₡${total.toFixed(2)})`);
    }
  }

  console.log(`     Órdenes verificadas: ${ordersChecked}`);
  console.log(`     Órdenes con total ₡0: ${ordersWithZeroTotal}`);
  checkIntegrity(ordersWithZeroTotal === 0, `No orders with ₡0 total that had items sent (found ${ordersWithZeroTotal})`);

  console.log("\n  3. Ledger Consistency:");
  const dashR = await httpReq("GET", "/api/dashboard", managerSession);
  if (dashR.status === 200) {
    const ledgerItems = dashR.data?.ledgerDetails || [];
    const ledgerTotal = ledgerItems.reduce((s: number, l: any) => s + Number(l.lineSubtotal || 0), 0);
    console.log(`     Ledger entries: ${ledgerItems.length}`);
    console.log(`     Ledger total: ₡${ledgerTotal.toFixed(2)}`);

    const paymentTotals = dashR.data?.paymentMethodTotals;
    if (paymentTotals && Array.isArray(paymentTotals)) {
      const paymentSum = paymentTotals.reduce((s: number, m: any) => s + Number(m.total || 0), 0);
      console.log(`     Payment total: ₡${paymentSum.toFixed(2)}`);

      const paidAmt = dashR.data?.paidOrders?.amount || 0;
      const ledgerVsPayment = Math.abs(paymentSum - Number(paidAmt));
      checkIntegrity(ledgerVsPayment < 1, `Payment sum (₡${paymentSum.toFixed(2)}) matches paid orders (₡${Number(paidAmt).toFixed(2)}) - diff: ₡${ledgerVsPayment.toFixed(2)}`);
    }
  }
}

function printPerformanceReport() {
  console.log("\n── REPORTE DE RENDIMIENTO ────────────────────────\n");

  const thresholds = {
    green: 100,
    yellow: 300,
  };

  function colorTag(ms: number): string {
    if (ms <= thresholds.green) return "🟢";
    if (ms <= thresholds.yellow) return "🟡";
    return "🔴";
  }

  console.log("  Operación                     Count   Avg    P50    P95    P99    Max");
  console.log("  ─────────────────────────────────────────────────────────────────────");

  const sortedKeys = Object.keys(timings).sort((a, b) => {
    const avgA = timings[a].length > 0 ? timings[a].reduce((s, v) => s + v, 0) / timings[a].length : 0;
    const avgB = timings[b].length > 0 ? timings[b].reduce((s, v) => s + v, 0) / timings[b].length : 0;
    return avgB - avgA;
  });

  for (const key of sortedKeys) {
    const arr = timings[key];
    if (arr.length === 0) continue;
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const p50 = percentile(arr, 50);
    const p95 = percentile(arr, 95);
    const p99 = percentile(arr, 99);
    const max = Math.max(...arr);
    const tag = colorTag(p95);

    const label = key.padEnd(30);
    console.log(
      `  ${tag} ${label} ${String(arr.length).padStart(5)}  ${avg.toFixed(0).padStart(5)}ms ${p50.toFixed(0).padStart(5)}ms ${p95.toFixed(0).padStart(5)}ms ${p99.toFixed(0).padStart(5)}ms ${max.toFixed(0).padStart(5)}ms`
    );
  }

  console.log("\n  Umbrales: 🟢 P95 ≤ 100ms | 🟡 P95 ≤ 300ms | 🔴 P95 > 300ms");

  const allLatencies = Object.values(timings).flat();
  if (allLatencies.length > 0) {
    const totalReqs = allLatencies.length;
    const totalTime = allLatencies.reduce((s, v) => s + v, 0);
    const avgAll = totalTime / totalReqs;
    console.log(`\n  Total requests: ${totalReqs}`);
    console.log(`  Overall avg latency: ${avgAll.toFixed(0)}ms`);
    console.log(`  Overall P95: ${percentile(allLatencies, 95).toFixed(0)}ms`);
    console.log(`  Overall P99: ${percentile(allLatencies, 99).toFixed(0)}ms`);
  }

  const bottlenecks = sortedKeys.filter(k => {
    const arr = timings[k];
    if (arr.length === 0) return false;
    return percentile(arr, 95) > 300;
  });

  if (bottlenecks.length > 0) {
    console.log("\n  ⚠ CUELLOS DE BOTELLA DETECTADOS (P95 > 300ms):");
    for (const k of bottlenecks) {
      const arr = timings[k];
      const p95 = percentile(arr, 95);
      console.log(`    - ${k}: P95=${p95.toFixed(0)}ms (${arr.length} calls)`);
    }
  } else {
    console.log("\n  ✓ No se detectaron cuellos de botella (todas las operaciones P95 ≤ 300ms)");
  }
}

function printFinalReport() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  RESULTADO FINAL");
  console.log("══════════════════════════════════════════════════\n");

  console.log(`  Verificaciones pasadas:  ${integrityPassed}`);
  console.log(`  Errores de integridad:   ${integrityErrors.length}`);

  if (integrityErrors.length > 0) {
    console.log("\n  ERRORES DETALLADOS:");
    for (const err of integrityErrors.slice(0, 30)) {
      console.log(`    ✗ ${err}`);
    }
    if (integrityErrors.length > 30) {
      console.log(`    ... y ${integrityErrors.length - 30} más`);
    }
  }

  const verdict = integrityErrors.length === 0 ? "PASS" : "FAIL";
  console.log(`\n  VEREDICTO: ${verdict}`);
  console.log(`  (${integrityPassed} checks passed, ${integrityErrors.length} errors)\n`);
}

async function run() {
  const globalStart = Date.now();

  await setup();
  await phaseWaiterSendOrders();
  await phaseKitchenProcess();
  const paymentData = await phaseCashierPayments();
  await phaseDashboardVerification(paymentData);
  await phaseIntegrityChecks();
  printPerformanceReport();
  printFinalReport();

  const totalElapsed = Date.now() - globalStart;
  console.log(`  Tiempo total: ${(totalElapsed / 1000).toFixed(1)}s\n`);
}

run().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
