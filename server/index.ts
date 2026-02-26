import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { createServer } from "http";

const app = express();

/**
 * Health checks MUST be fast and always return 200.
 * Replit checks "/" by default.
 * Keep these before any middleware (helmet, compression, body parsers, auth, etc).
 */
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

const httpServer = createServer(app);

app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";

let appReady = false;

if (isProduction) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: [
            "'self'",
            "https://*.replit.app",
            "https://*.replit.dev",
            "https://*.repl.co",
          ],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      hsts: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xFrameOptions: false,
    }),
  );
}

app.use(compression());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function sanitizeObject(obj: any): any {
  if (typeof obj === "string") return stripHtmlTags(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = sanitizeObject(obj[key]);
    }
    return result;
  }
  return obj;
}

app.use((req, _res, next) => {
  if (
    req.body &&
    typeof req.body === "object" &&
    ["POST", "PUT", "PATCH"].includes(req.method)
  ) {
    req.body = sanitizeObject(req.body);
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
        const sensitiveKeys = [
          "password",
          "pin",
          "guestPhone",
          "guestEmail",
          "customerPhone",
          "customerEmail",
          "phone",
          "email",
        ];
        for (const key of sensitiveKeys) {
          if (key in sanitized) sanitized[key] = "[REDACTED]";
        }
        logLine += ` :: ${JSON.stringify(sanitized).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function warmup() {
  try {
    const { ensureSystemPermissions } = await import("./storage");
    await ensureSystemPermissions();

    const { registerRoutes } = await import("./routes");
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const isDev = process.env.NODE_ENV === "development";

      console.error("Internal Server Error:", err.message, isDev ? err.stack : "");

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({
        message: status >= 500 ? "Error interno del servidor" : err.message || "Error",
      });
    });

    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    } else {
      const { serveStatic } = await import("./static");
      serveStatic(app);
    }

    appReady = true;
    log("Application fully initialized");

    const { startHrBackgroundJobs } = await import("./hr-jobs");
    startHrBackgroundJobs();

    const { retryPendingSync } = await import("./quickbooks");
    setInterval(() => {
      retryPendingSync().catch((err) =>
        console.error("[QBO] Retry queue error:", err.message),
      );
    }, 5 * 60 * 1000);
  } catch (err: any) {
    console.error("Warmup failed:", err);
    process.exit(1);
  }
}

const port = Number(process.env.PORT) || 5000;

httpServer.listen(
  {
    port,
    host: "0.0.0.0",
    reusePort: true,
  },
  () => {
    log(`serving on port ${port}`);
    // Defer warmup so health checks can pass immediately
    setTimeout(() => void warmup(), 500);
  },
);