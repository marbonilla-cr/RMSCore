import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { ensureSystemPermissions } from "./storage";
import { startHrBackgroundJobs } from "./hr-jobs";

const app = express();
const httpServer = createServer(app);

app.use(helmet({
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
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xFrameOptions: { action: "deny" },
}));

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
  await ensureSystemPermissions();
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
