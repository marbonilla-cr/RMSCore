import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { ensureSystemPermissions } from "./storage";
import { startHrBackgroundJobs } from "./hr-jobs";
import { pool } from "./db";
import fs from "fs";

const app = express();
const httpServer = createServer(app);

app.use(compression());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && duration > 200) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

function cleanCategoryName(name: string): string {
  if (!name) return name;
  return name.replace(/^\d+-/, "").trim();
}

function csvTimestampToUtc(ts: string): string | null {
  if (!ts || ts.trim() === "") return null;
  const parts = ts.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return null;
  const [, yr, mo, dy, hr, mi, se] = parts;
  return `${yr}-${mo}-${dy}T${hr}:${mi}:${se}.000Z`;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function mapPaymentCode(code: string): number {
  switch (code) {
    case "CASH": return 1;
    case "TARJETA": return 2;
    case "SINPE": return 3;
    default: return 2;
  }
}

async function runLoyverseReimport() {
  try {
    console.log("[REIMPORT] Deleting all existing LOYVERSE_POS data...");
    await pool.query(`DELETE FROM payments WHERE order_id IN (SELECT DISTINCT order_id FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS')`);
    await pool.query(`DELETE FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'`);
    console.log("[REIMPORT] Old data deleted. Starting fresh import...");

    const ledgerPath = "attached_assets/sales_ledger_items_import_v2_with_order_id_1771384006312.csv";
    const paymentsPath = "attached_assets/payments_import_prefer_tarjeta_1771424281023.csv";

    if (!fs.existsSync(ledgerPath) || !fs.existsSync(paymentsPath)) {
      console.log("[REIMPORT] CSV files not found. Skipping.");
      return;
    }

    const ledgerCsv = fs.readFileSync(ledgerPath, "utf-8");
    const ledgerLines = ledgerCsv.split("\n").filter((l: string) => l.trim());
    const ledgerRows = ledgerLines.slice(1);

    const BATCH = 200;
    let inserted = 0;

    for (let i = 0; i < ledgerRows.length; i += BATCH) {
      const batch = ledgerRows.slice(i, i + BATCH);
      const ph: string[] = [];
      const params: any[] = [];
      let p = 1;

      for (const row of batch) {
        const c = parseCsvLine(row);
        if (c.length < 21) continue;
        const bd = c[0], oid = parseInt(c[3]) || null, pc = c[6] || null;
        const pn = c[7] || null, cc = c[9] || null;
        const cn = c[10] ? cleanCategoryName(c[10]) : null;
        const qty = parseInt(c[11]) || 0, up = parseFloat(c[12]) || 0;
        const ls = parseFloat(c[13]) || 0, pat = c[20] || null;
        const cat = csvTimestampToUtc(pat || `${bd} 12:00:00`);
        const pau = pat ? csvTimestampToUtc(pat) : null;

        ph.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},'LOYVERSE_POS')`);
        params.push(bd, cat, oid, pc, pn, cc, cn, qty, up, ls, pau, "PAID");
        p += 12;
      }

      if (ph.length > 0) {
        await pool.query(
          `INSERT INTO sales_ledger_items (business_date, created_at, order_id, product_code_snapshot, product_name_snapshot, category_code_snapshot, category_name_snapshot, qty, unit_price, line_subtotal, paid_at, status, origin) VALUES ${ph.join(",")}`,
          params
        );
        inserted += ph.length;
      }
    }
    console.log(`[REIMPORT] Ledger: ${inserted} rows.`);

    const paymentsCsv = fs.readFileSync(paymentsPath, "utf-8");
    const paymentLines = paymentsCsv.split("\n").filter((l: string) => l.trim());
    const paymentRows = paymentLines.slice(1);
    let pInserted = 0;

    for (let i = 0; i < paymentRows.length; i += BATCH) {
      const batch = paymentRows.slice(i, i + BATCH);
      const ph: string[] = [];
      const params: any[] = [];
      let p = 1;

      for (const row of batch) {
        const c = parseCsvLine(row);
        if (c.length < 7) continue;
        const oid = parseInt(c[1]) || null;
        const bd = c[2], mc = c[3], amt = parseFloat(c[4]) || 0;
        const st = c[5] || "PAID", pat = c[6] || null;
        if (st === "PENDING" || !oid) continue;
        const pmid = mapPaymentCode(mc);
        const pau = csvTimestampToUtc(pat || `${bd} 12:00:00`);

        ph.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},1)`);
        params.push(oid, amt, pmid, pau, "PAID", bd);
        p += 6;
      }

      if (ph.length > 0) {
        await pool.query(
          `INSERT INTO payments (order_id, amount, payment_method_id, paid_at, status, business_date, cashier_user_id) VALUES ${ph.join(",")}`,
          params
        );
        pInserted += ph.length;
      }
    }
    console.log(`[REIMPORT] Payments: ${pInserted} rows.`);
    console.log("[REIMPORT] Complete!");
  } catch (err) {
    console.error("[REIMPORT] Error:", err);
  }
}

(async () => {
  await ensureSystemPermissions();
  if (process.env.RUN_LOYVERSE_REIMPORT === "true") {
    await runLoyverseReimport();
  }
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  } else {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startHrBackgroundJobs();
    },
  );
})();
