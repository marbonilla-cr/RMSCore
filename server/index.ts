import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import path from "path";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { ensureSystemPermissions, seedExtraTypes, seedDefaultRolePermissions } from "./storage";
import { startHrBackgroundJobs } from "./hr-jobs";
import { startDispatchBackgroundJobs } from "./dispatch-jobs";
import { retryPendingSync } from "./quickbooks";
import { runTenantLifecycleCheck } from "./provision/provision-service";
import { ensurePublicTables } from "./provision/seed-own-tenant";
import { syncAllTenantsAtStartup } from "./provision/migrate-tenants";
import { setTimezonePool } from "./utils/timezone";
import { pool } from "./db";

const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

if (isProduction) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://accounts.google.com", "https://apis.google.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"],
        connectSrc: ["'self'", "ws:", "wss:", "https://accounts.google.com", "https://oauth2.googleapis.com"],
        frameSrc: ["'none'", "https://accounts.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", "https://*.replit.app", "https://*.replit.dev", "https://*.repl.co"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xFrameOptions: false,
  }));
}

app.use(compression());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare global {
  namespace Express {
    interface Request {
      isLoyaltyApp?: boolean;
    }
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

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') return stripHtmlTags(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = sanitizeObject(obj[key]);
    }
    return result;
  }
  return obj;
}

app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.body = sanitizeObject(req.body);
  }
  next();
});

// Loyalty PWA host detection
app.use((req, res, next) => {
  const host = req.headers.host || "";
  if (host.startsWith("loyalty.") && !req.path.startsWith("/api/") && !req.path.startsWith("/auth/")) {
    const loyaltyDir = path.join(process.cwd(), "client-loyalty");
    if (req.path === "/" || !req.path.includes(".")) {
      return res.sendFile(path.join(loyaltyDir, "index.html"));
    }
    return res.sendFile(path.join(loyaltyDir, req.path.replace(/^\//, "")), (err) => {
      if (err) res.sendFile(path.join(loyaltyDir, "index.html"));
    });
  }
  next();
});

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
        const sanitized = { ...capturedJsonResponse };
        const sensitiveKeys = ['password', 'pin', 'guestPhone', 'guestEmail', 'customerPhone', 'customerEmail', 'phone', 'email'];
        for (const key of sensitiveKeys) {
          if (key in sanitized) sanitized[key] = '[REDACTED]';
        }
        logLine += ` :: ${JSON.stringify(sanitized).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  setTimezonePool(pool);
  await ensureSystemPermissions();
  await seedDefaultRolePermissions();
  await seedExtraTypes();
  ensurePublicTables().catch(err => {
    console.error("[startup] Error en tenant seed:", err.message);
  });
  syncAllTenantsAtStartup().catch(err => {
    console.error("[startup] Error en migración de tenants:", err.message);
  });
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isDev = process.env.NODE_ENV === "development";

    console.error("Internal Server Error:", err.message, isDev ? err.stack : "");

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({
      message: status >= 500 ? "Error interno del servidor" : (err.message || "Error"),
    });
  });

  const devMode = process.env.NODE_ENV === "development";
  if (devMode) {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  } else {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  }

  const port = Number(process.env.PORT) || 5000;
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);

    startHrBackgroundJobs();
    startDispatchBackgroundJobs();

    setInterval(() => {
      retryPendingSync().catch(err => console.error("[QBO] Retry queue error:", err.message));
    }, 5 * 60 * 1000);

    setInterval(() => {
      runTenantLifecycleCheck().catch(err => console.error("[lifecycle] Error:", err.message));
    }, 60 * 60 * 1000);
  });
})();
