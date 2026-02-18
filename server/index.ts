import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { ensureSystemPermissions } from "./storage";
import { startHrBackgroundJobs } from "./hr-jobs";
import { db } from "./db";
import { sql } from "drizzle-orm";

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

async function runLoyverseTimestampFix() {
  try {
    const check = await db.execute(sql`
      SELECT EXTRACT(HOUR FROM created_at) as raw_hour, COUNT(*) as cnt
      FROM sales_ledger_items 
      WHERE origin = 'LOYVERSE_POS' 
        AND business_date >= '2025-12-01' AND business_date <= '2025-12-31'
      GROUP BY raw_hour ORDER BY cnt DESC LIMIT 1
    `);
    const peakHour = Number(check.rows?.[0]?.raw_hour ?? -1);
    if (peakHour >= 4 && peakHour <= 12) {
      console.log(`[MIGRATION] Loyverse timestamps need fix (peak raw hour=${peakHour}). Applying +12h...`);
      const r1 = await db.execute(sql`
        UPDATE sales_ledger_items 
        SET created_at = created_at + INTERVAL '12 hours',
            paid_at = paid_at + INTERVAL '12 hours',
            business_date = (((created_at + INTERVAL '12 hours') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date::text
        WHERE origin = 'LOYVERSE_POS'
      `);
      const r2 = await db.execute(sql`
        UPDATE payments 
        SET paid_at = paid_at + INTERVAL '12 hours'
        WHERE order_id IN (SELECT DISTINCT order_id FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS')
        AND paid_at IS NOT NULL
      `);
      const r3 = await db.execute(sql`
        UPDATE sales_ledger_items
        SET category_name_snapshot = regexp_replace(category_name_snapshot, '^\d+-', '')
        WHERE origin = 'LOYVERSE_POS' AND category_name_snapshot ~ '^\d+-'
      `);
      console.log(`[MIGRATION] Done: ledger=${r1.rowCount}, payments=${r2.rowCount}, categories=${r3.rowCount}`);
    } else {
      console.log(`[MIGRATION] Loyverse timestamps already correct (peak raw hour=${peakHour}). Skipping.`);
    }
  } catch (err) {
    console.error("[MIGRATION] Loyverse timestamp fix error:", err);
  }
}

(async () => {
  await ensureSystemPermissions();
  await runLoyverseTimestampFix();
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
