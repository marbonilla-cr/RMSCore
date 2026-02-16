import http from "http";

const BASE = "http://localhost:5000";
let cookie = "";

async function httpReq(method: string, path: string, body?: any): Promise<{ ms: number; status: number }> {
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
        resolve({ ms: Date.now() - t0, status: res.statusCode || 0 });
      });
    });
    r.on("error", () => resolve({ ms: Date.now() - t0, status: 0 }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  await httpReq("POST", "/api/auth/login", { username: "marcelo", password: "1234" });

  const endpoints = [
    "/api/waiter/tables",
    "/api/waiter/menu",
    "/api/waiter/categories",
    "/api/pos/tables",
    "/api/pos/payment-methods",
    "/api/pos/paid-orders",
    "/api/kds/tickets/KITCHEN",
    "/api/kds/tickets/BAR",
    "/api/dashboard",
    "/api/admin/employees",
    "/api/admin/products",
    "/api/admin/categories",
    "/api/admin/tables",
    "/api/admin/payment-methods",
    "/api/admin/tax-categories",
    "/api/admin/modifier-groups",
    "/api/admin/discounts",
    "/api/admin/business-config",
    "/api/admin/printers",
    "/api/hr/settings",
    "/api/hr/team-clock-status",
    "/api/inventory/items",
    "/api/inventory/suppliers",
    "/api/inventory/purchase-orders",
    "/api/inventory/recipes",
    "/api/inventory/physical-counts",
    "/api/inventory/reports/valuation",
    "/api/inventory/reports/low-stock",
    "/api/shortages/active",
    "/api/shortages/products",
    "/api/shortages/inv-items",
    "/api/audit-alerts",
    "/api/auth/my-permissions",
    "/api/business-config",
  ];

  const results: { path: string; avg: number; min: number; max: number; runs: number[] }[] = [];

  for (const path of endpoints) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await httpReq("GET", path);
      times.push(r.ms);
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    results.push({ path, avg, min: Math.min(...times), max: Math.max(...times), runs: times });
  }

  results.sort((a, b) => b.avg - a.avg);

  console.log("\nENDPOINT LATENCY REPORT (ms) - 5 runs each");
  console.log("=".repeat(75));
  console.log("  Avg  Min  Max  Endpoint");
  console.log("-".repeat(75));
  for (const r of results) {
    const flag = r.avg > 100 ? " *** SLOW" : r.avg > 50 ? " * WARN" : "";
    console.log(
      String(r.avg).padStart(5) +
        String(r.min).padStart(5) +
        String(r.max).padStart(5) +
        "  " +
        r.path +
        flag
    );
  }

  const slowCount = results.filter((r) => r.avg > 100).length;
  const warnCount = results.filter((r) => r.avg > 50 && r.avg <= 100).length;
  console.log("\n" + "=".repeat(75));
  console.log(`  SLOW (>100ms): ${slowCount}  |  WARN (>50ms): ${warnCount}  |  OK: ${results.length - slowCount - warnCount}`);
}

main().catch(console.error);
