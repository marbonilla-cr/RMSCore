import http from "http";

const BASE = "http://localhost:5000";
let cookie = "";
let testUserId: number;
let testTableId: number;
let testCategoryId: number;
let testProductId: number;
let testOrderId: number;
let testOrderItemId: number;
let testPaymentMethodId: number;
let testCashSessionId: number;
let testSplitId: number;
let testKitchenTicketId: number;
let testInvItemId: number;
let testSupplierId: number;
let testPOId: number;
let testRecipeId: number;
let testCountId: number;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];
const startTime = Date.now();

async function req(method: string, path: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };

    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
          cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
        }
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode || 0, data: parsed });
      });
    });

    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function skip(msg: string) {
  skipped++;
  console.log(`  ⊘ SKIP: ${msg}`);
}

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n▸ ${name}`);
  try {
    await fn();
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ EXCEPTION: ${err.message}`);
  }
}

async function run() {
  console.log("═══════════════════════════════════════");
  console.log("  RESTAURANT SYSTEM - TEST SUITE");
  console.log("═══════════════════════════════════════\n");

  // ==================== AUTH ====================
  await test("AUTH: login with bad credentials returns 401", async () => {
    const r = await req("POST", "/api/auth/login", { username: "nonexist", password: "wrong" });
    assert(r.status === 401, "Status 401 for bad login");
  });

  await test("AUTH: login as manager", async () => {
    const r = await req("POST", "/api/auth/login", { username: "_test_mgr", password: "Test1234!" });
    if (r.status === 401) {
      const create = await req("POST", "/api/auth/login", { username: "marcelo", password: "1234" });
      if (create.status !== 200) {
        skip("Cannot login as existing manager - skipping setup");
        return;
      }
      cookie = "";
      const loginMgr = await req("POST", "/api/auth/login", { username: "marcelo", password: "1234" });
      assert(loginMgr.status === 200, "Login as marcelo");
      cookie = "";
    }
  });

  await test("AUTH: login as marcelo (manager)", async () => {
    const r = await req("POST", "/api/auth/login", { username: "marcelo", password: "1234" });
    if (r.status !== 200) {
      const r2 = await req("POST", "/api/auth/login", { username: "marcelo", password: "marcelo" });
      if (r2.status !== 200) {
        const r3 = await req("POST", "/api/auth/login", { username: "marcelo", password: "Marcelo1234" });
        assert(r3.status === 200, `Login succeeded (status=${r3.status})`);
      } else {
        assert(true, "Login succeeded");
      }
    } else {
      assert(true, "Login succeeded");
    }
  });

  await test("AUTH: /api/auth/me returns user", async () => {
    const r = await req("GET", "/api/auth/me");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
    if (r.status === 200) {
      assert(r.data.role === "MANAGER", `Role is MANAGER`);
    }
  });

  await test("AUTH: /api/auth/my-permissions returns permissions", async () => {
    const r = await req("GET", "/api/auth/my-permissions");
    assert(r.status === 200, `Status 200`);
    const perms = Array.isArray(r.data) ? r.data : r.data?.permissions;
    assert(Array.isArray(perms), "Returns permissions list");
    assert(perms.length > 0, "Has at least one permission");
  });

  // ==================== ADMIN: TABLES ====================
  await test("ADMIN: list tables", async () => {
    const r = await req("GET", "/api/admin/tables");
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array");
    if (r.data.length > 0) testTableId = r.data[0].id;
  });

  await test("ADMIN: create table", async () => {
    const r = await req("POST", "/api/admin/tables", { tableName: "_TEST_TABLE", tableCode: "_TST" + Date.now() });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testTableId = r.data.id;
  });

  // ==================== ADMIN: CATEGORIES ====================
  await test("ADMIN: list categories", async () => {
    const r = await req("GET", "/api/admin/categories");
    assert(r.status === 200, `Status 200`);
    if (r.data?.length > 0) testCategoryId = r.data[0].id;
  });

  await test("ADMIN: create category", async () => {
    const r = await req("POST", "/api/admin/categories", {
      name: "_TEST_CAT",
      categoryCode: "_TCAT" + Date.now(),
      sortOrder: 999,
    });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testCategoryId = r.data.id;
  });

  // ==================== ADMIN: PRODUCTS ====================
  await test("ADMIN: list products", async () => {
    const r = await req("GET", "/api/admin/products");
    assert(r.status === 200, `Status 200`);
    if (r.data?.length > 0) testProductId = r.data[0].id;
  });

  await test("ADMIN: create product", async () => {
    const r = await req("POST", "/api/admin/products", {
      name: "_TEST_PRODUCT",
      description: "Test product for automated tests",
      productCode: "_TP" + Date.now(),
      categoryId: testCategoryId,
      price: 5000,
      active: true,
    });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testProductId = r.data.id;
  });

  // ==================== ADMIN: PAYMENT METHODS ====================
  await test("ADMIN: list payment methods", async () => {
    const r = await req("GET", "/api/admin/payment-methods");
    assert(r.status === 200, `Status 200`);
    if (r.data?.length > 0) testPaymentMethodId = r.data[0].id;
  });

  // ==================== ADMIN: TAX CATEGORIES ====================
  await test("ADMIN: list tax categories", async () => {
    const r = await req("GET", "/api/admin/tax-categories");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== ADMIN: EMPLOYEES ====================
  await test("ADMIN: list employees", async () => {
    const r = await req("GET", "/api/admin/employees");
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array");
  });

  // ==================== ADMIN: PERMISSIONS ====================
  await test("ADMIN: list permissions", async () => {
    const r = await req("GET", "/api/admin/permissions");
    assert(r.status === 200, `Status 200`);
  });

  await test("ADMIN: list role-permissions", async () => {
    const r = await req("GET", "/api/admin/role-permissions");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== ADMIN: PRINTERS ====================
  await test("ADMIN: list printers", async () => {
    const r = await req("GET", "/api/admin/printers");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== ADMIN: MODIFIER GROUPS ====================
  await test("ADMIN: list modifier groups", async () => {
    const r = await req("GET", "/api/admin/modifier-groups");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== ADMIN: DISCOUNTS ====================
  await test("ADMIN: list discounts", async () => {
    const r = await req("GET", "/api/admin/discounts");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== ADMIN: BUSINESS CONFIG ====================
  await test("ADMIN: get business config", async () => {
    const r = await req("GET", "/api/admin/business-config");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== WAITER ====================
  await test("WAITER: list tables", async () => {
    const r = await req("GET", "/api/waiter/tables");
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array");
  });

  await test("WAITER: get table detail", async () => {
    if (!testTableId) { skip("No table ID"); return; }
    const r = await req("GET", `/api/waiter/tables/${testTableId}`);
    assert(r.status === 200, `Status 200`);
  });

  await test("WAITER: get menu", async () => {
    const r = await req("GET", "/api/waiter/menu");
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array of products");
  });

  await test("WAITER: get categories", async () => {
    const r = await req("GET", "/api/waiter/categories");
    assert(r.status === 200, `Status 200`);
  });

  await test("WAITER: send round (create order)", async () => {
    if (!testTableId || !testProductId) { skip("No table or product"); return; }
    const r = await req("POST", `/api/waiter/tables/${testTableId}/send-round`, {
      items: [{ productId: testProductId, qty: 2, notes: "test round" }],
    });
    assert(r.status === 200 || r.status === 201, `Send round (status=${r.status})`);
    if (r.data?.orderId) testOrderId = r.data.orderId;
    if (r.data?.items?.length > 0) testOrderItemId = r.data.items[0].id;
  });

  await test("WAITER: get table order after send", async () => {
    if (!testTableId) { skip("No table ID"); return; }
    const r = await req("GET", `/api/waiter/tables/${testTableId}/order`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  // ==================== KDS ====================
  await test("KDS: get kitchen tickets", async () => {
    const r = await req("GET", "/api/kds/tickets/KITCHEN");
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array");
    if (r.data.length > 0) {
      testKitchenTicketId = r.data[0].id;
    }
  });

  await test("KDS: get bar tickets", async () => {
    const r = await req("GET", "/api/kds/tickets/BAR");
    assert(r.status === 200, `Status 200`);
  });

  await test("KDS: update item status", async () => {
    if (!testKitchenTicketId) { skip("No kitchen ticket"); return; }
    const r = await req("GET", `/api/kds/tickets/KITCHEN`);
    if (r.data?.length > 0 && r.data[0].items?.length > 0) {
      const itemId = r.data[0].items[0].id;
      const update = await req("PATCH", `/api/kds/items/${itemId}`, { status: "IN_PROGRESS" });
      assert(update.status === 200, `Updated KDS item (status=${update.status})`);
    } else {
      skip("No KDS items to update");
    }
  });

  // ==================== POS ====================
  await test("POS: list tables", async () => {
    const r = await req("GET", "/api/pos/tables");
    assert(r.status === 200, `Status 200`);
  });

  await test("POS: list payment methods", async () => {
    const r = await req("GET", "/api/pos/payment-methods");
    assert(r.status === 200, `Status 200`);
  });

  await test("POS: open cash session", async () => {
    const r = await req("POST", "/api/pos/cash-session/open", { openingAmount: 50000 });
    assert(r.status === 200 || r.status === 201 || r.status === 400, `Open session (status=${r.status})`);
    if (r.data?.id) testCashSessionId = r.data.id;
  });

  await test("POS: get active cash session", async () => {
    const r = await req("GET", "/api/pos/cash-session/active");
    assert(r.status === 200 || r.status === 404, `Active session (status=${r.status})`);
    if (r.data?.id) testCashSessionId = r.data.id;
  });

  await test("POS: get order details", async () => {
    if (!testOrderId) { skip("No order"); return; }
    const r = await req("GET", `/api/pos/orders/${testOrderId}`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
    if (r.data?.items?.length > 0) testOrderItemId = r.data.items[0].id;
  });

  await test("POS: add items to order", async () => {
    if (!testOrderId || !testProductId) { skip("No order or product"); return; }
    const r = await req("POST", `/api/pos/orders/${testOrderId}/add-items`, {
      items: [{ productId: testProductId, qty: 1, notes: "POS add" }],
    });
    assert(r.status === 200 || r.status === 201, `Added items (status=${r.status})`);
  });

  await test("POS: pay order (cash)", async () => {
    if (!testOrderId || !testPaymentMethodId) { skip("No order or payment method"); return; }
    if (!testCashSessionId) { skip("No cash session"); return; }
    const orderR = await req("GET", `/api/pos/orders/${testOrderId}`);
    const total = orderR.data?.total || orderR.data?.balanceDue || 10000;
    const r = await req("POST", `/api/pos/orders/${testOrderId}/pay`, {
      paymentMethodId: testPaymentMethodId,
      amount: Number(total),
      reference: "TEST-PAY",
    });
    assert(r.status === 200 || r.status === 201, `Payment (status=${r.status})`);
  });

  await test("POS: get paid orders", async () => {
    const r = await req("GET", "/api/pos/paid-orders");
    assert(r.status === 200, `Status 200`);
  });

  await test("POS: get order payments", async () => {
    if (!testOrderId) { skip("No order"); return; }
    const r = await req("GET", `/api/pos/orders/${testOrderId}/payments`);
    assert(r.status === 200, `Status 200`);
  });

  // ==================== SPLITS ====================
  await test("POS SPLIT: create new order for split test", async () => {
    if (!testTableId || !testProductId) { skip("No table or product"); return; }
    const tables = await req("GET", "/api/admin/tables");
    let freeTableId: number | null = null;
    for (const t of tables.data || []) {
      if (t.id !== testTableId && t.active) { freeTableId = t.id; break; }
    }
    if (!freeTableId) { skip("No free table for split test"); return; }
    const r = await req("POST", `/api/waiter/tables/${freeTableId}/send-round`, {
      items: [
        { productId: testProductId, qty: 1, notes: "split item A" },
        { productId: testProductId, qty: 1, notes: "split item B" },
        { productId: testProductId, qty: 1, notes: "split item C" },
      ],
    });
    if (r.data?.orderId) testOrderId = r.data.orderId;
    assert(r.status === 200 || r.status === 201, `Created order for split (status=${r.status})`);
  });

  await test("POS SPLIT: create split account (empty)", async () => {
    if (!testOrderId) { skip("No order"); return; }
    const r = await req("POST", `/api/pos/orders/${testOrderId}/splits`, {
      label: "Subcuenta 1",
      orderItemIds: [],
    });
    assert(r.status === 200 || r.status === 201, `Created split (status=${r.status})`);
    if (r.data?.id) testSplitId = r.data.id;
  });

  await test("POS SPLIT: list splits for order", async () => {
    if (!testOrderId) { skip("No order"); return; }
    const r = await req("GET", `/api/pos/orders/${testOrderId}/splits`);
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns array");
  });

  await test("POS SPLIT: move items to split", async () => {
    if (!testOrderId || !testSplitId) { skip("No order or split"); return; }
    const order = await req("GET", `/api/pos/orders/${testOrderId}`);
    const items = order.data?.items || [];
    if (items.length === 0) { skip("No items to move"); return; }
    const r = await req("POST", "/api/pos/split-items/move-bulk", {
      orderItemIds: [items[0].id],
      fromSplitId: null,
      toSplitId: testSplitId,
    });
    assert(r.status === 200, `Moved item (status=${r.status})`);
  });

  await test("POS SPLIT: return item to unassigned", async () => {
    if (!testOrderId || !testSplitId) { skip("No order or split"); return; }
    const splits = await req("GET", `/api/pos/orders/${testOrderId}/splits`);
    const split = splits.data?.find((s: any) => s.id === testSplitId);
    if (!split?.items?.length) { skip("No items in split"); return; }
    const r = await req("POST", "/api/pos/split-items/move-bulk", {
      orderItemIds: [split.items[0].orderItemId],
      fromSplitId: testSplitId,
      toSplitId: null,
    });
    assert(r.status === 200, `Returned item (status=${r.status})`);
  });

  await test("POS SPLIT: delete split", async () => {
    if (!testSplitId) { skip("No split"); return; }
    const r = await req("DELETE", `/api/pos/splits/${testSplitId}`);
    assert(r.status === 200, `Deleted split (status=${r.status})`);
  });

  // ==================== QR ====================
  await test("QR: get table info by code", async () => {
    const tables = await req("GET", "/api/admin/tables");
    if (!tables.data?.length) { skip("No tables"); return; }
    const code = tables.data[0].tableCode;
    const r = await req("GET", `/api/qr/${code}/info`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("QR: get menu by code", async () => {
    const tables = await req("GET", "/api/admin/tables");
    if (!tables.data?.length) { skip("No tables"); return; }
    const code = tables.data[0].tableCode;
    const r = await req("GET", `/api/qr/${code}/menu`);
    assert(r.status === 200, `Status 200`);
    assert(Array.isArray(r.data), "Returns menu array");
  });

  // ==================== DASHBOARD ====================
  await test("DASHBOARD: get dashboard data", async () => {
    const r = await req("GET", "/api/dashboard");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("DASHBOARD: get dashboard with date filter", async () => {
    const today = new Date().toISOString().split("T")[0];
    const r = await req("GET", `/api/dashboard?date=${today}`);
    assert(r.status === 200, `Status 200`);
  });

  // ==================== HR ====================
  await test("HR: get settings", async () => {
    const r = await req("GET", "/api/hr/settings");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("HR: get schedules", async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() - monday.getDay() + 1);
    const dateStr = monday.toISOString().split("T")[0];
    const r = await req("GET", `/api/hr/schedules?weekStartDate=${dateStr}`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("HR: get my punches", async () => {
    const r = await req("GET", "/api/hr/my-punches");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("HR: get team clock status", async () => {
    const r = await req("GET", "/api/hr/team-clock-status");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("HR: get overtime report", async () => {
    const now = new Date();
    const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const dateTo = now.toISOString().split("T")[0];
    const r = await req("GET", `/api/hr/overtime-report?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  // ==================== INVENTORY ====================
  await test("INV: list items", async () => {
    const r = await req("GET", "/api/inventory/items");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
    if (Array.isArray(r.data) && r.data.length > 0) testInvItemId = r.data[0].id;
  });

  await test("INV: create item", async () => {
    const r = await req("POST", "/api/inventory/items", {
      code: "_TST" + Date.now(),
      name: "_TEST_INV_ITEM",
      baseUom: "KG",
      currentQty: 100,
      reorderPoint: 10,
      wac: 500,
    });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testInvItemId = r.data.id;
  });

  await test("INV: get item detail", async () => {
    if (!testInvItemId) { skip("No inv item"); return; }
    const r = await req("GET", `/api/inventory/items/${testInvItemId}`);
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: get kardex", async () => {
    if (!testInvItemId) { skip("No inv item"); return; }
    const r = await req("GET", `/api/inventory/items/${testInvItemId}/kardex`);
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: list suppliers", async () => {
    const r = await req("GET", "/api/inventory/suppliers");
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: create supplier", async () => {
    const r = await req("POST", "/api/inventory/suppliers", {
      code: "_SUP" + Date.now(),
      name: "_TEST_SUPPLIER",
    });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testSupplierId = r.data.id;
  });

  await test("INV: list purchase orders", async () => {
    const r = await req("GET", "/api/inventory/purchase-orders");
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: create purchase order", async () => {
    if (!testSupplierId || !testInvItemId) { skip("No supplier or inv item"); return; }
    const r = await req("POST", "/api/inventory/purchase-orders", {
      supplierId: testSupplierId,
      lines: [{ invItemId: testInvItemId, qty: 50, unitCost: 600, uom: "KG" }],
    });
    assert(r.status === 200 || r.status === 201, `Created (status=${r.status})`);
    if (r.data?.id) testPOId = r.data.id;
  });

  await test("INV: list recipes", async () => {
    const r = await req("GET", "/api/inventory/recipes");
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: list physical counts", async () => {
    const r = await req("GET", "/api/inventory/physical-counts");
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: valuation report", async () => {
    const r = await req("GET", "/api/inventory/reports/valuation");
    assert(r.status === 200, `Status 200`);
  });

  await test("INV: low stock report", async () => {
    const r = await req("GET", "/api/inventory/reports/low-stock");
    assert(r.status === 200, `Status 200`);
  });

  // ==================== SHORTAGES ====================
  await test("SHORTAGES: list active", async () => {
    const r = await req("GET", "/api/shortages/active");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("SHORTAGES: list products for reporting", async () => {
    const r = await req("GET", "/api/shortages/products");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("SHORTAGES: list inv-items for reporting", async () => {
    const r = await req("GET", "/api/shortages/inv-items");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("SHORTAGES: list categories for reporting", async () => {
    const r = await req("GET", "/api/shortages/categories");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  await test("SHORTAGES: report shortage (inv item)", async () => {
    if (!testInvItemId) { skip("No inv item"); return; }
    const r = await req("POST", "/api/shortages/report", {
      itemType: "INV_ITEM",
      itemId: testInvItemId,
      severity: "LOW_STOCK",
      notes: "Test shortage",
    });
    assert(r.status === 200 || r.status === 201 || r.status === 409, `Report (status=${r.status})`);
  });

  await test("SHORTAGES: audit alerts list", async () => {
    const r = await req("GET", "/api/audit-alerts");
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  // ==================== VOID / REOPEN ====================
  await test("POS: void order item", async () => {
    if (!testOrderId) { skip("No order"); return; }
    const order = await req("GET", `/api/pos/orders/${testOrderId}`);
    const items = order.data?.items || [];
    const activeItem = items.find((i: any) => i.status !== "VOIDED");
    if (!activeItem) { skip("No active items to void"); return; }
    const r = await req("POST", `/api/waiter/orders/${testOrderId}/items/${activeItem.id}/void`, {
      reason: "Test void",
    });
    assert(r.status === 200, `Voided (status=${r.status})`);
  });

  // ==================== CASH SESSION ====================
  await test("POS: cash session report", async () => {
    if (!testCashSessionId) { skip("No cash session"); return; }
    const r = await req("GET", `/api/pos/cash-session/${testCashSessionId}/report`);
    assert(r.status === 200, `Status 200 (got ${r.status})`);
  });

  // ==================== AUTH: LOGOUT ====================
  await test("AUTH: logout", async () => {
    const r = await req("POST", "/api/auth/logout");
    assert(r.status === 200, `Status 200`);
  });

  await test("AUTH: /me after logout returns 401", async () => {
    const r = await req("GET", "/api/auth/me");
    assert(r.status === 401, `Status 401 (got ${r.status})`);
  });

  // ==================== UNAUTHORIZED ACCESS ====================
  await test("SECURITY: admin endpoint without auth returns 401", async () => {
    cookie = "";
    const r = await req("GET", "/api/admin/employees");
    assert(r.status === 401 || r.status === 403, `Blocked (status=${r.status})`);
  });

  await test("SECURITY: POS endpoint without auth returns 401", async () => {
    const r = await req("GET", "/api/pos/tables");
    assert(r.status === 401 || r.status === 403, `Blocked (status=${r.status})`);
  });

  await test("SECURITY: dashboard without auth returns 401", async () => {
    const r = await req("GET", "/api/dashboard");
    assert(r.status === 401 || r.status === 403, `Blocked (status=${r.status})`);
  });

  // ==================== RESULTS ====================
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n═══════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsed}s)`);
  console.log("═══════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  FAILURES:");
    failures.forEach((f) => console.log(`    - ${f}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
