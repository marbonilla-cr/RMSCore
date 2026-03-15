import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server, ServerResponse } from "http";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";
import crypto from "crypto";
import { sql, and, eq, gte, lte, inArray, or, ne, asc, desc, count } from "drizzle-orm";
import { db } from "./db";
import * as storage from "./storage";
import { registerInventoryRoutes } from "./inventory-routes";
import { computeRangePayroll, computeServiceForRange, round2, type HrConfig, type PunchRecord, type ScheduleDay, type ExtraRecord } from "./payroll";
import { registerShortageRoutes } from "./shortage-routes";
import { registerSalesCubeRoutes } from "./sales-cube-routes";
import { registerQrSubaccountRoutes } from "./qr-subaccount-routes";
import * as invStorage from "./inventory-storage";
import { getTenantTimezone, getBusinessDateInTZ, getNowInTZ, invalidateTimezoneCache } from "./utils/timezone";
import { generateTransactionCode } from "./utils/transaction-code";
import { onOrderItemsConfirmedSent, onOrderItemsVoided } from "./inventory-deduction";
import * as qbo from "./quickbooks";
import { tenantMiddleware } from "./middleware/tenant";
import { registerDispatchRoutes, registerDispatchSession, notifyDispatchReady } from "./dispatch-routes";
import { initDispatchJobs } from "./dispatch-jobs";
import { registerLoyaltyRoutes } from "./loyalty-routes";
import { registerProvisionRoutes } from "./provision/provision-routes";
import { registerDataLoaderRoutes } from "./data-loader/data-loader-routes";
import {
  registerBridge,
  unregisterBridge,
  validateBridgeToken,
  authenticateBridgeByMessage,
  isBridgeConnected,
  getConnectedBridgesForTenant,
  dispatchPrintJobViaBridge,
} from "./services/print-service";
import { printBridges as printBridgesTable, printers as printersTable } from "../shared/schema";
import { pool } from "./db";
import { getTenantDb } from "./db-tenant";
import { loginSchema, pinLoginSchema, enrollPinSchema, insertBusinessConfigSchema, insertPrinterSchema, insertModifierGroupSchema, insertModifierOptionSchema, insertDiscountSchema, insertTaxCategorySchema, insertHrSettingsSchema, insertHrWeeklyScheduleSchema, insertHrScheduleDaySchema, insertHrTimePunchSchema, insertServiceChargeLedgerSchema, insertServiceChargePayoutSchema, reservations, reservationDurationConfig, reservationSettings, tables as tablesSchema, orders, qrSubmissions, kitchenTickets, orderSubaccounts, orderItems, kitchenTicketItems, salesLedgerItems, categories, products, voidedItems, payments, splitItems, splitAccounts, auditEvents, orderItemDiscounts, hrOvertimeApprovals, qboSyncLog, employeeCharges, users } from "@shared/schema";
import { VOID_REASON_CODES, type VoidReasonCode } from "@shared/voidReasons";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

async function getOrCreateOrderForTable(tableId: number, responsibleWaiterId: number | null, schema?: string, dbInstance?: typeof db) {
  let order = await storage.getOpenOrderForTable(tableId, dbInstance);
  if (order) return order;
  try {
    const businessDate = await getBusinessDate(schema);
    order = await storage.createOrder({
      tableId,
      status: "OPEN",
      responsibleWaiterId,
      businessDate,
    }, dbInstance);
    try {
      const txCode = await generateTransactionCode(dbInstance || db, businessDate);
      order = await storage.updateOrder(order.id, { transactionCode: txCode } as any, dbInstance);
    } catch (codeErr) {
      console.warn("[txCode] No se pudo asignar código de transacción:", codeErr);
    }
  } catch (e: any) {
    order = await storage.getOpenOrderForTable(tableId, dbInstance);
    if (order) return order;
    throw e;
  }
  return order;
}

async function cleanupSubaccountsForOrder(orderId: number, dbInstance: typeof db) {
  try {
    await dbInstance.delete(orderSubaccounts).where(eq(orderSubaccounts.orderId, orderId));
  } catch (err) {
    console.error("[Subaccount Cleanup] Error cleaning subaccounts for order", orderId, err);
  }
}

function aggregateTaxBreakdown(taxes: { taxNameSnapshot: string; taxRateSnapshot: string; taxAmount: string; inclusiveSnapshot: boolean }[]) {
  const map = new Map<string, { taxName: string; taxRate: string; inclusive: boolean; totalAmount: number }>();
  for (const t of taxes) {
    const key = `${t.taxNameSnapshot}|${t.taxRateSnapshot}|${t.inclusiveSnapshot}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalAmount += Number(t.taxAmount);
    } else {
      map.set(key, { taxName: t.taxNameSnapshot, taxRate: t.taxRateSnapshot, inclusive: t.inclusiveSnapshot, totalAmount: Number(t.taxAmount) });
    }
  }
  return Array.from(map.values()).map(v => ({ taxName: v.taxName, taxRate: v.taxRate, inclusive: v.inclusive, totalAmount: Number(v.totalAmount.toFixed(2)) }));
}

// WebSocket broadcast
const wsClients = new Set<WebSocket>();

function broadcast(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

initDispatchJobs(broadcast);

// Login rate limiter - per IP, 5 attempts per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

// Public API rate limiter - per IP, 30 requests per minute
const publicApiHits = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_API_WINDOW_MS = 60 * 1000;
const PUBLIC_API_MAX = 30;

function checkPublicRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = publicApiHits.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= PUBLIC_API_MAX) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ message: "Demasiadas solicitudes. Intente de nuevo en un momento." });
      return false;
    }
    entry.count++;
  } else {
    publicApiHits.set(ip, { count: 1, resetAt: now + PUBLIC_API_WINDOW_MS });
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of publicApiHits) {
    if (entry.resetAt <= now) publicApiHits.delete(ip);
  }
}, 60 * 1000);

function checkLoginRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ message: `Demasiados intentos. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.` });
      return false;
    }
    entry.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  }
  return true;
}

function clearLoginRateLimit(req: Request) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  loginAttempts.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  const keys = Array.from(loginAttempts.keys());
  for (const ip of keys) {
    const entry = loginAttempts.get(ip);
    if (entry && entry.resetAt <= now) loginAttempts.delete(ip);
  }
}, 60 * 1000);

function createRateLimiter(maxRequests: number, windowMs: number, minIntervalMs = 0) {
  const store = new Map<string, { count: number; resetAt: number; lastAt: number }>();
  setInterval(() => {
    const now = Date.now();
    const keys = Array.from(store.keys());
    for (const ip of keys) {
      const entry = store.get(ip);
      if (entry && entry.resetAt <= now) store.delete(ip);
    }
  }, 60 * 1000);
  return (req: Request, res: Response): boolean => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = store.get(ip);
    if (entry && entry.resetAt > now) {
      if (minIntervalMs > 0 && (now - entry.lastAt) < minIntervalMs) {
        const retryAfter = Math.ceil((minIntervalMs - (now - entry.lastAt)) / 1000);
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({ message: `Espere ${retryAfter} segundos antes de intentar de nuevo.` });
        return false;
      }
      if (entry.count >= maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({ message: `Demasiadas solicitudes. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.` });
        return false;
      }
      entry.count++;
      entry.lastAt = now;
    } else {
      store.set(ip, { count: 1, resetAt: now + windowMs, lastAt: now });
    }
    return true;
  };
}

const reservationRateCheck = createRateLimiter(3, 60 * 1000, 10 * 1000);
const qrSubmitRateCheck = createRateLimiter(5, 60 * 1000, 5 * 1000);
const qrSubaccountRateCheck = createRateLimiter(10, 60 * 1000, 3 * 1000);

function generateQrDailyToken(tableCode: string, date: string): string {
  const secret = process.env.SESSION_SECRET || "qr-fallback";
  return crypto.createHmac("sha256", secret).update(`${tableCode}:${date}`).digest("hex").substring(0, 16);
}

async function getBusinessDateCR(schema?: string): Promise<string> {
  const tz = await getTenantTimezone(schema || process.env.TENANT_SCHEMA || "public");
  const now = getNowInTZ(tz);
  if (now.getHours() < 5) {
    now.setDate(now.getDate() - 1);
  }
  return now.toISOString().split("T")[0];
}

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "No autenticado" });
  }
  next();
}

function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) return res.status(401).json({ message: "No autenticado" });
    const user = await storage.getUser(req.session.userId, req.db);
    if (!user) return res.status(403).json({ message: "Sin permisos" });
    if (roles.includes(user.role)) {
      (req as any).user = user;
      return next();
    }
    const userPerms = await storage.getPermissionKeysForRole(user.role, req.db);
    const moduleMap: Record<string, string> = {
      WAITER: "MODULE_TABLES_VIEW",
      KITCHEN: "MODULE_KDS_VIEW",
      CASHIER: "MODULE_POS_VIEW",
      MANAGER: "MODULE_ADMIN_VIEW",
    };
    const neededModulePerms = roles.map(r => moduleMap[r]).filter(Boolean);
    if (neededModulePerms.some(p => userPerms.includes(p))) {
      (req as any).user = user;
      return next();
    }
    return res.status(403).json({ message: "Sin permisos" });
  };
}

function requirePermission(...permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) return res.status(401).json({ message: "No autenticado" });
    const user = await storage.getUser(req.session.userId, req.db);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    (req as any).user = user;
    const userPerms = await storage.getPermissionKeysForRole(user.role, req.db);
    for (const key of permissionKeys) {
      if (!userPerms.includes(key)) {
        return res.status(403).json({ message: "Sin permiso" });
      }
    }
    next();
  };
}

async function getBusinessDate(schema?: string): Promise<string> {
  const tz = await getTenantTimezone(schema || process.env.TENANT_SCHEMA || "public");
  return getBusinessDateInTZ(tz);
}

async function sendHrAlertEmail(settings: any, subject: string, textBody: string) {
  try {
    if (!settings?.lateAlertEmailTo) return;
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) return;
    const nodemailer = await import("nodemailer");
    const transporter = (nodemailer.default || nodemailer).createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || smtpUser,
      to: settings.lateAlertEmailTo,
      subject,
      text: textBody,
    });
  } catch (err) {
    console.error("[HR] Failed to send alert email:", err);
  }
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function maybeAutoCloseOrder(orderId: number, broadcastFn: typeof broadcast, dbInstance?: typeof db): Promise<{ closed: boolean; newStatus?: string } | null> {
  try {
    const order = await storage.getOrder(orderId, dbInstance);
    if (!order) return null;
    if (order.status === "PAID" || order.status === "VOIDED") return null;

    const allItems = await storage.getOrderItems(orderId, dbInstance);
    const activeItems = allItems.filter(i => i.status !== "VOIDED");

    if (activeItems.length === 0) {
      const childOrders = await storage.getChildOrders(orderId, dbInstance);

      if (childOrders.length > 0) {
        const allChildrenDone = childOrders.every(c => c.status === "PAID" || c.status === "VOIDED");
        if (allChildrenDone) {
          await storage.updateOrder(orderId, { status: "PAID", closedAt: new Date() }, dbInstance);
          broadcastFn("order_updated", { tableId: order.tableId, orderId });
          broadcastFn("table_status_changed", { tableId: order.tableId });
          broadcastFn("order_auto_closed", { orderId, tableId: order.tableId, reason: "all_children_done" });
          return { closed: true, newStatus: "PAID" };
        }
      } else {
        await storage.updateOrder(orderId, { status: "VOIDED", closedAt: new Date() }, dbInstance);
        broadcastFn("order_updated", { tableId: order.tableId, orderId });
        broadcastFn("table_status_changed", { tableId: order.tableId });
        broadcastFn("order_auto_closed", { orderId, tableId: order.tableId, reason: "no_active_items" });
        return { closed: true, newStatus: "VOIDED" };
      }
    }

    const balance = Number(order.balanceDue || 0);
    const totalAmount = Number(order.totalAmount || 0);

    if (balance <= 0 && activeItems.length > 0) {
      const allPaidOrZero = activeItems.every(i =>
        i.status === "PAID" || Number(i.productPriceSnapshot) === 0
      );
      if (allPaidOrZero) {
        for (const ai of activeItems) {
          if (ai.status !== "PAID") {
            await storage.updateOrderItem(ai.id, { status: "PAID" }, dbInstance);
            await storage.updateSalesLedgerItems(ai.id, { status: "PAID", paidAt: new Date() }, dbInstance);
          }
        }
        await storage.updateOrder(orderId, {
          status: "PAID",
          closedAt: new Date(),
          balanceDue: "0.00",
          totalAmount: Math.max(0, totalAmount).toFixed(2),
        }, dbInstance);
        broadcastFn("order_updated", { tableId: order.tableId, orderId });
        broadcastFn("table_status_changed", { tableId: order.tableId });
        broadcastFn("order_auto_closed", { orderId, tableId: order.tableId, reason: "zero_balance" });
        return { closed: true, newStatus: "PAID" };
      }
    }

    if (balance <= 0 && activeItems.length > 0) {
      const childOrders = await storage.getChildOrders(orderId, dbInstance);
      if (childOrders.length > 0) {
        const allChildrenDone = childOrders.every(c => c.status === "PAID" || c.status === "VOIDED");
        if (allChildrenDone) {
          for (const ai of activeItems) {
            if (ai.status !== "PAID") {
              await storage.updateOrderItem(ai.id, { status: "PAID" }, dbInstance);
              await storage.updateSalesLedgerItems(ai.id, { status: "PAID", paidAt: new Date() }, dbInstance);
            }
          }
          await storage.updateOrder(orderId, {
            status: "PAID",
            closedAt: new Date(),
            balanceDue: "0.00",
          }, dbInstance);
          broadcastFn("order_updated", { tableId: order.tableId, orderId });
          broadcastFn("table_status_changed", { tableId: order.tableId });
          broadcastFn("order_auto_closed", { orderId, tableId: order.tableId, reason: "children_paid_balance_zero" });
          return { closed: true, newStatus: "PAID" };
        }
      }
    }

    return { closed: false };
  } catch (err) {
    console.error("[maybeAutoCloseOrder] Error:", err);
    return null;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Health check — before any auth middleware
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", ts: Date.now() });
  });

  // Session setup
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  const pgSession = (await import("connect-pg-simple")).default(session);

  app.set("trust proxy", 1);

  const isProduction = process.env.NODE_ENV === "production";

  const { pool } = await import("./db");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  const sessionStore = new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: "session",
    pruneSessionInterval: 60 * 15,
  });

  const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" as const : false as any,
      maxAge: 24 * 60 * 60 * 1000,
    },
  });
  app.use(sessionMiddleware);
  app.set("sessionMiddleware", sessionMiddleware);
  app.use(tenantMiddleware);

  app.use((req, _res, next) => {
    if (req.session.userId) return next();
    const token = req.headers["x-session-token"] as string | undefined;
    if (!token) return next();
    sessionStore.get(token, (err: any, sess: any) => {
      if (!err && sess && sess.userId) {
        req.session.userId = sess.userId;
      }
      next();
    });
  });

  // ==================== AUTH ====================
  app.post("/api/auth/login", async (req, res) => {
    if (!checkLoginRateLimit(req, res)) return;
    try {
      const { username, password } = loginSchema.parse(req.body);
      const tdb = req.db;
      const user = await storage.getUserByUsername(username, tdb);
      if (!user || !user.active) {
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
      }
      const valid = await storage.verifyPassword(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
      }
      clearLoginRateLimit(req);
      req.session.userId = user.id;
      (req.session as any).tenantSchema = req.tenantSchema;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: user.id, action: "LOGIN_PASSWORD", entityType: "USER", entityId: user.id, metadata: {} }, tdb);
      const { password: _, pin: _p, ...safeUser } = user;
      req.session.save(async (err) => {
        if (err) {
          console.error("[SESSION] save error (password login):", err);
          return res.status(500).json({ message: "Error de sesión" });
        }
        const perms = await storage.getPermissionKeysForRole(user.role, tdb);
        res.json({ user: { ...safeUser, hasPin: !!user.pin }, permissions: perms, sessionToken: req.sessionID });
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/auth/user-info", async (req, res) => {
    try {
      const username = (req.query.username as string || "").trim().toLowerCase();
      if (!username) return res.json({ exists: false, hasPin: false, displayName: "" });
      const user = await storage.getUserByUsername(username, req.db);
      if (!user || !user.active) return res.json({ exists: false, hasPin: false, displayName: "" });
      res.json({ exists: true, hasPin: !!user.pin, displayName: user.displayName });
    } catch { res.json({ exists: false, hasPin: false, displayName: "" }); }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.json({ message: "ok" });
      const allUsers = await storage.getAllUsers(req.db);
      const user = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase() && u.active);
      if (user) {
        const crypto = await import("crypto");
        const resetToken = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await storage.setResetToken(user.id, resetToken, expires, req.db);
        const host = req.get("host") || "localhost:5000";
        const proto = req.get("x-forwarded-proto") || req.protocol;
        const resetUrl = `${proto}://${host}/reset-password?token=${resetToken}`;
        const { sendEmail } = await import("./services/email-service");
        await sendEmail(
          email,
          "Recuperación de acceso - RMSCore",
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#333">Recuperación de acceso</h2>
            <p>Recibimos una solicitud para restablecer tu contraseña.</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#b08d57;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Restablecer contraseña</a></p>
            <p style="color:#888;font-size:13px">Este enlace es válido por 1 hora. Si no solicitaste este cambio, ignora este correo.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
            <p style="color:#aaa;font-size:11px">Este correo fue generado automáticamente por RMSCore.</p>
          </div>`
        );
      }
      res.json({ message: "ok" });
    } catch (err: any) {
      console.error("[auth] forgot-password error:", err.message);
      res.json({ message: "ok" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ message: "Datos incompletos" });
      if (newPassword.length < 6) return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      const user = await storage.getUserByResetToken(token, req.db);
      if (!user) return res.status(400).json({ message: "Token inválido o expirado" });
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.resetPassword(user.id, hashedPassword, req.db);
      res.json({ message: "Contraseña actualizada" });
    } catch (err: any) {
      console.error("[auth] reset-password error:", err.message);
      res.status(500).json({ message: "Error interno" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.session.userId) {
      await storage.createAuditEvent({ actorType: "USER", actorUserId: req.session.userId, action: "LOGOUT", entityType: "USER", entityId: req.session.userId, metadata: {} }, req.db);
    }
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    const tdb = req.db;
    const user = await storage.getUser(req.session.userId, tdb);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    const { password: _, pin: _p, ...safeUser } = user;
    const perms = await storage.getPermissionKeysForRole(user.role, tdb);
    res.json({ ...safeUser, hasPin: !!user.pin, permissions: perms });
  });

  // PIN Login
  app.post("/api/auth/pin-login", async (req, res) => {
    if (!checkLoginRateLimit(req, res)) return;
    try {
      const { pin } = pinLoginSchema.parse(req.body);
      const tdb = req.db;
      const allUsers = await storage.getAllUsersWithPin(tdb);
      const usersWithPin = allUsers.filter(u => u.pin && u.active);

      for (const u of usersWithPin) {
        if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) {
          continue;
        }
        const match = await storage.verifyPin(pin, u.pin!);
        if (match) {
          await storage.clearPinLock(u.id, tdb);
          clearLoginRateLimit(req);
          req.session.userId = u.id;
          (req.session as any).tenantSchema = req.tenantSchema;
          await storage.createAuditEvent({ actorType: "USER", actorUserId: u.id, action: "LOGIN_PIN", entityType: "USER", entityId: u.id, metadata: {} }, tdb);
          const fullUser = await storage.getUser(u.id, tdb);
          if (!fullUser) return res.status(500).json({ message: "Error interno" });
          const { password: _, pin: _p, ...safeUser } = fullUser;
          return req.session.save(async (err) => {
            if (err) {
              console.error("[SESSION] save error (PIN login):", err);
              return res.status(500).json({ message: "Error de sesión" });
            }
            const perms = await storage.getPermissionKeysForRole(fullUser.role, tdb);
            res.json({ user: { ...safeUser, hasPin: true }, permissions: perms, sessionToken: req.sessionID });
          });
        }
      }

      res.status(401).json({ message: "PIN incorrecto" });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  const voidPinAttempts = new Map<string, { count: number; resetAt: number }>();
  const VOID_PIN_WINDOW_MS = 5 * 60 * 1000;
  const VOID_PIN_MAX_ATTEMPTS = 5;

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of voidPinAttempts) {
      if (entry.resetAt <= now) voidPinAttempts.delete(ip);
    }
  }, 60 * 1000);

  app.post("/api/auth/verify-manager-pin", requireAuth, async (req, res) => {
    try {
      const { pin } = req.body;
      if (!pin || typeof pin !== "string") {
        return res.status(400).json({ message: "PIN requerido" });
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = voidPinAttempts.get(ip);
      if (entry && entry.resetAt > now) {
        if (entry.count >= VOID_PIN_MAX_ATTEMPTS) {
          const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
          res.set("Retry-After", String(retryAfter));
          return res.status(429).json({ message: `Demasiados intentos. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.` });
        }
      }

      const tdb = req.db;
      const allUsers = await storage.getAllUsersWithPin(tdb);
      const usersWithPin = allUsers.filter(u => u.pin && u.active);

      let matchedUser: any = null;
      for (const u of usersWithPin) {
        if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) continue;
        const match = await storage.verifyPin(pin, u.pin!);
        if (match) {
          matchedUser = u;
          break;
        }
      }

      if (!matchedUser) {
        if (entry && entry.resetAt > now) {
          entry.count++;
        } else {
          voidPinAttempts.set(ip, { count: 1, resetAt: now + VOID_PIN_WINDOW_MS });
        }

        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: req.session.userId || null,
          action: "VOID_AUTH_FAILED",
          entityType: "USER",
          entityId: null,
          metadata: { ip, reason: "PIN incorrecto o no encontrado" },
        }, tdb);

        return res.status(403).json({ message: "PIN de autorización incorrecto" });
      }

      const perms = await storage.getPermissionKeysForRole(matchedUser.role, tdb);
      if (!perms.includes("VOID_AUTHORIZE")) {
        if (entry && entry.resetAt > now) {
          entry.count++;
        } else {
          voidPinAttempts.set(ip, { count: 1, resetAt: now + VOID_PIN_WINDOW_MS });
        }

        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: req.session.userId || null,
          action: "VOID_AUTH_FAILED",
          entityType: "USER",
          entityId: matchedUser.id,
          metadata: { ip, reason: "Usuario no tiene permiso VOID_AUTHORIZE", matchedUserId: matchedUser.id },
        }, tdb);

        return res.status(403).json({ message: "El usuario no tiene permiso para autorizar anulaciones" });
      }

      voidPinAttempts.delete(ip);

      res.json({ authorized: true, managerId: matchedUser.id, managerName: matchedUser.displayName });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PIN-based Clock-In/Out (no session required)
  app.post("/api/auth/pin-clock", async (req, res) => {
    try {
      const { pin, action, lat, lng, accuracy } = req.body;
      if (!pin || !action) return res.status(400).json({ message: "PIN y acción requeridos" });
      if (action !== "clock_in" && action !== "clock_out") return res.status(400).json({ message: "Acción inválida" });

      const allUsers = await storage.getAllUsersWithPin(req.db);
      const usersWithPin = allUsers.filter(u => u.pin && u.active);

      let matchedUser: any = null;
      for (const u of usersWithPin) {
        if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) continue;
        const match = await storage.verifyPin(pin, u.pin!);
        if (match) {
          matchedUser = u;
          break;
        }
      }

      if (!matchedUser) return res.status(401).json({ message: "PIN incorrecto" });

      await storage.clearPinLock(matchedUser.id);
      const employeeId = matchedUser.id;
      const perms = await storage.getPermissionKeysForRole(matchedUser.role);
      if (!perms.includes("HR_CLOCK_IN_OUT_ALLOW")) {
        return res.status(403).json({ message: "No tiene permiso para marcar entrada/salida" });
      }

      const settings = await storage.getHrSettings(req.db);
      const tz = await getTenantTimezone(req.tenantSchema);
      const now = new Date();
      const localNow = getNowInTZ(tz);
      const businessDate = await getBusinessDate(req.tenantSchema);

      if (action === "clock_in") {
        const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);
        if (openPunch) return res.status(409).json({ message: "Ya tiene una entrada abierta. Marque salida primero." });

        let geoVerified = false;
        if (settings && settings.geoEnforcementEnabled && settings.geoRequiredForClockin && settings.businessLat && settings.businessLng) {
          if (!lat || !lng) return res.status(400).json({ message: "Ubicación requerida para marcar entrada" });
          if (accuracy && Number(accuracy) > (settings.geoAccuracyMaxMeters || 100)) {
            return res.status(400).json({ message: `Precisión GPS insuficiente` });
          }
          const distance = haversineDistance(Number(settings.businessLat), Number(settings.businessLng), Number(lat), Number(lng));
          if (distance > (settings.geoRadiusMeters || 120)) {
            return res.status(403).json({ message: `Fuera del rango permitido (${Math.round(distance)}m)` });
          }
          geoVerified = true;
        }

        const weekDay = localNow.getDay();
        let lateMinutes = 0;
        let scheduledStartAt: Date | undefined;
        let scheduledEndAt: Date | undefined;
        const dayOffset = weekDay === 0 ? 6 : weekDay - 1;
        const mondayDate = new Date(localNow);
        mondayDate.setDate(mondayDate.getDate() - dayOffset);
        const weekStartDate = mondayDate.toLocaleDateString("en-CA", { timeZone: tz });
        const schedule = await storage.getWeeklySchedule(employeeId, weekStartDate, req.db);
        let hasScheduleToday = false;
        if (schedule) {
          const days = await storage.getScheduleDays(schedule.id, req.db);
          const todaySchedule = days.find(d => d.dayOfWeek === weekDay);
          if (todaySchedule && !todaySchedule.isDayOff && todaySchedule.startTime) {
            hasScheduleToday = true;
            const [h, m] = todaySchedule.startTime.split(":").map(Number);
            scheduledStartAt = new Date(localNow);
            scheduledStartAt.setHours(h, m, 0, 0);
            if (todaySchedule.endTime) {
              const [eh, em] = todaySchedule.endTime.split(":").map(Number);
              scheduledEndAt = new Date(localNow);
              scheduledEndAt.setHours(eh, em, 0, 0);
            }
            const graceMinutes = settings?.latenessGraceMinutes || 0;
            const diffMs = localNow.getTime() - scheduledStartAt.getTime();
            const diffMinutes = Math.floor(diffMs / 60000);
            if (diffMinutes > graceMinutes) lateMinutes = diffMinutes - graceMinutes;
          }
        }

        if (!hasScheduleToday && !req.body.confirmNoSchedule) {
          return res.json({ requireConfirm: true, message: "No tiene horario hoy. Ingrese su código nuevamente para confirmar." });
        }

        const punch = await storage.createTimePunch({
          employeeId,
          businessDate,
          clockInAt: now,
          scheduledStartAt: scheduledStartAt || null,
          scheduledEndAt: scheduledEndAt || null,
          lateMinutes,
          clockinGeoLat: lat ? String(lat) : null,
          clockinGeoLng: lng ? String(lng) : null,
          clockinGeoAccuracyM: accuracy ? String(accuracy) : null,
          clockinGeoVerified: geoVerified,
        }, req.db);

        const auditAction = hasScheduleToday ? "CLOCK_IN" : "CLOCK_IN_NO_SCHEDULE_CONFIRMED";
        await storage.createAuditEvent({
          actorType: "USER", actorUserId: employeeId,
          action: auditAction, entityType: "HR_PUNCH", entityId: punch.id,
          metadata: { lateMinutes, geoVerified, viaPin: true, hasScheduleToday },
        });

        broadcast("hr_punch_update", { employeeId, type: "clock_in" });
        const user = await storage.getUser(employeeId);
        return res.json({ punch, displayName: user?.displayName || "Empleado", action: "clock_in" });
      }

      if (action === "clock_out") {
        const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);

        let geoVerified = false;
        if (settings && settings.geoEnforcementEnabled && settings.geoRequiredForClockout && settings.businessLat && settings.businessLng) {
          if (!lat || !lng) return res.status(400).json({ message: "Ubicación requerida para marcar salida" });
          if (accuracy && Number(accuracy) > (settings.geoAccuracyMaxMeters || 100)) {
            return res.status(400).json({ message: `Precisión GPS insuficiente (${Math.round(Number(accuracy))}m)` });
          }
          const distance = haversineDistance(Number(settings.businessLat), Number(settings.businessLng), Number(lat), Number(lng));
          if (distance > (settings.geoRadiusMeters || 120)) {
            return res.status(403).json({ message: `Fuera del rango permitido (${Math.round(distance)}m)` });
          }
          geoVerified = true;
        }

        const user = await storage.getUser(employeeId);

        if (!openPunch) {
          await storage.createAuditEvent({
            actorType: "USER", actorUserId: employeeId,
            action: "CLOCK_OUT_BLOCKED_NO_ENTRY", entityType: "HR_PUNCH", entityId: 0,
            metadata: { note: "Attempted clock-out without prior clock-in (PIN)" },
          });
          return res.status(400).json({ message: "No puede marcar salida si no ha marcado entrada primero." });
        }

        const workedMs = now.getTime() - new Date(openPunch.clockInAt).getTime();
        const workedMinutes = Math.floor(workedMs / 60000);
        const dailyThresholdMinutes = settings ? Number(settings.overtimeDailyThresholdHours) * 60 : 480;
        const overtimeMinutesDaily = Math.max(0, workedMinutes - dailyThresholdMinutes);

        const updatedPunch = await storage.updateTimePunch(openPunch.id, {
          clockOutAt: now,
          clockOutType: "MANUAL",
          workedMinutes,
          overtimeMinutesDaily,
          clockoutGeoLat: lat ? String(lat) : null,
          clockoutGeoLng: lng ? String(lng) : null,
          clockoutGeoAccuracyM: accuracy ? String(accuracy) : null,
          clockoutGeoVerified: geoVerified,
        }, req.db);

        await storage.createAuditEvent({
          actorType: "USER", actorUserId: employeeId,
          action: "CLOCK_OUT", entityType: "HR_PUNCH", entityId: openPunch.id,
          metadata: { workedMinutes, overtimeMinutesDaily, geoVerified, viaPin: true },
        });

        broadcast("hr_punch_update", { employeeId, type: "clock_out" });
        return res.json({ punch: updatedPunch, displayName: user?.displayName || "Empleado", action: "clock_out", workedMinutes });
      }
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // PIN Enrollment
  app.post("/api/auth/enroll-pin", requireAuth, async (req, res) => {
    try {
      const { pin } = enrollPinSchema.parse(req.body);
      await storage.enrollPin(req.session.userId!, pin, req.db);
      await storage.createAuditEvent({ actorType: "USER", actorUserId: req.session.userId!, action: "PIN_SET", entityType: "USER", entityId: req.session.userId!, metadata: {} }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // My permissions
  app.get("/api/auth/my-permissions", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!, req.db);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    const perms = await storage.getPermissionKeysForRole(user.role, req.db);
    res.json({ permissions: perms, role: user.role });
  });

  // ==================== ADMIN: EMPLOYEES ====================
  app.get("/api/admin/employees", requireRole("MANAGER"), async (req, res) => {
    const allUsers = await storage.getAllUsers(req.db);
    const safe = allUsers.map(u => {
      const { password: _, pin: _p, ...rest } = u;
      return { ...rest, hasPin: !!u.pin };
    });
    res.json(safe);
  });

  app.post("/api/admin/employees", requireRole("MANAGER"), async (req, res) => {
    try {
      const { username, password, displayName, role, active, email, dailyRate } = req.body;
      if (!username || !password || !displayName || !role) {
        return res.status(400).json({ message: "Campos requeridos: username, password, displayName, role" });
      }
      const existing = await storage.getUserByUsername(username, req.db);
      if (existing) return res.status(400).json({ message: "Username ya existe" });
      const user = await storage.createUser({ username, password, displayName, role, active: active !== false, email: email || null, dailyRate: dailyRate || null }, req.db);
      const { password: _, pin: _p, ...safeUser } = user;
      res.json({ ...safeUser, hasPin: !!user.pin });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/employees/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { displayName, role, active, email, username } = req.body;
      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (role !== undefined) updates.role = role;
      if (active !== undefined) updates.active = active;
      if (email !== undefined) updates.email = email;
      if (req.body.dailyRate !== undefined) updates.dailyRate = req.body.dailyRate;
      if (username !== undefined) {
        const existing = await storage.getUserByUsername(username, req.db);
        if (existing && existing.id !== id) return res.status(400).json({ message: "Username ya existe" });
        updates.username = username;
      }
      if (active === false) {
        const actor = (req as any).user;
        await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "USER_DISABLED", entityType: "USER", entityId: id, metadata: {} }, req.db);
      }
      const user = await storage.updateUser(id, updates, req.db);
      const { password: _, pin: _p, ...safeUser } = user;
      res.json({ ...safeUser, hasPin: !!user.pin });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/reset-password", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "Password requerido" });
      await storage.updateUser(id, { password }, req.db);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PASSWORD_RESET", entityType: "USER", entityId: id, metadata: {} }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/reset-pin", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.resetPin(id, req.db);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PIN_RESET", entityType: "USER", entityId: id, metadata: {} }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/generate-pin", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const pin = await storage.generateAndSetPin(id, req.db);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PIN_GENERATED", entityType: "USER", entityId: id, metadata: {} }, req.db);
      res.json({ pin });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PERMISSIONS ====================
  app.get("/api/admin/permissions", requireRole("MANAGER"), async (req, res) => {
    const perms = await storage.getAllPermissions(req.db);
    res.json(perms);
  });

  app.get("/api/admin/role-permissions", requireRole("MANAGER"), async (req, res) => {
    const roles = ["MANAGER", "FARM_MANAGER", "CASHIER", "WAITER", "KITCHEN", "STAFF"];
    const result: Record<string, string[]> = {};
    for (const role of roles) {
      result[role] = await storage.getPermissionKeysForRole(role, req.db);
    }
    res.json(result);
  });

  app.put("/api/admin/role-permissions/:role", requireRole("MANAGER"), async (req, res) => {
    try {
      const role = req.params.role as string;
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) return res.status(400).json({ message: "permissions debe ser un array" });
      await storage.setRolePermissions(role, permissions, req.db);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "ROLE_PERMISSIONS_CHANGED", entityType: "ROLE", metadata: { role, permissions } }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: TABLES ====================
  app.get("/api/admin/tables", requireRole("MANAGER"), async (req, res) => {
    res.json(await storage.getAllTables(false, req.db));
  });

  app.post("/api/admin/tables", requireRole("MANAGER"), async (req, res) => {
    try {
      const { tableCode, tableName, active, sortOrder } = req.body;
      if (!tableCode || typeof tableCode !== "string" || !tableCode.trim()) {
        return res.status(400).json({ message: "El código de mesa es requerido" });
      }
      if (!tableName || typeof tableName !== "string" || !tableName.trim()) {
        return res.status(400).json({ message: "El nombre de mesa es requerido" });
      }
      const capacity = req.body.capacity;
      const data = {
        tableCode: tableCode.trim(),
        tableName: tableName.trim(),
        active: active !== undefined ? Boolean(active) : true,
        sortOrder: typeof sortOrder === "number" ? sortOrder : parseInt(String(sortOrder)) || 0,
        capacity: Math.max(1, Math.min(50, typeof capacity === "number" ? capacity : parseInt(String(capacity)) || 4)),
      };
      const table = await storage.createTable(data, req.db);
      res.json(table);
    } catch (err: any) {
      const msg = err.message || "Error al crear mesa";
      if (msg.includes("unique constraint")) {
        return res.status(400).json({ message: `Ya existe una mesa con el código "${req.body.tableCode}"` });
      }
      res.status(400).json({ message: msg });
    }
  });

  app.patch("/api/admin/tables/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const updates: any = {};
      if (req.body.tableCode !== undefined) updates.tableCode = String(req.body.tableCode).trim();
      if (req.body.tableName !== undefined) updates.tableName = String(req.body.tableName).trim();
      if (req.body.active !== undefined) updates.active = Boolean(req.body.active);
      if (req.body.sortOrder !== undefined) updates.sortOrder = typeof req.body.sortOrder === "number" ? req.body.sortOrder : parseInt(String(req.body.sortOrder)) || 0;
      if (req.body.capacity !== undefined) updates.capacity = Math.max(1, Math.min(50, typeof req.body.capacity === "number" ? req.body.capacity : parseInt(String(req.body.capacity)) || 4));
      const table = await storage.updateTable(parseInt(req.params.id as string), updates, req.db);
      res.json(table);
    } catch (err: any) {
      const msg = err.message || "Error al actualizar mesa";
      if (msg.includes("unique constraint")) {
        return res.status(400).json({ message: `Ya existe una mesa con el código "${req.body.tableCode}"` });
      }
      res.status(400).json({ message: msg });
    }
  });

  app.patch("/api/admin/tables/:id/archive", requireRole("MANAGER"), async (req, res) => {
    try {
      const result = await storage.softDeleteTable(parseInt(req.params.id as string), req.db);
      if (!result) return res.status(404).json({ message: "Mesa no encontrada" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error al archivar mesa" });
    }
  });

  app.get("/api/admin/tables/:id/qr", requireRole("MANAGER"), async (req, res) => {
    const table = await storage.getTable(parseInt(req.params.id as string), req.db);
    if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
    const host = req.headers.host || "localhost:5000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const url = `${protocol}://${host}/qr/${table.tableCode}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 2, width: 300 });
    const html = `<!DOCTYPE html><html><head><title>QR - ${table.tableName}</title>
    <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;margin:0;padding:20px}
    h1{margin-bottom:20px;font-size:24px}p{color:#666;margin-top:10px}</style></head>
    <body><h1>${table.tableName}</h1>${svg}<p>${url}</p></body></html>`;
    res.set("Content-Type", "text/html").send(html);
  });

  app.get("/api/admin/tables/:id/qr.png", requireRole("MANAGER"), async (req, res) => {
    const table = await storage.getTable(parseInt(req.params.id as string), req.db);
    if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
    const host = req.headers.host || "localhost:5000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const url = `${protocol}://${host}/qr/${table.tableCode}`;
    const pngBuffer = await QRCode.toBuffer(url, { type: "png", margin: 2, width: 600, color: { dark: "#000000", light: "#FFFFFF" } });
    res.set("Content-Type", "image/png");
    res.set("Content-Disposition", `attachment; filename="QR-${table.tableName.replace(/[^a-zA-Z0-9_-]/g, "_")}.png"`);
    res.send(pngBuffer);
  });

  // ==================== ADMIN: CATEGORIES ====================
  app.get("/api/admin/categories", requireRole("MANAGER"), async (req, res) => {
    res.json(await storage.getAllCategories(req.db));
  });

  app.post("/api/admin/categories/seed-tops", requireRole("MANAGER"), async (req, res) => {
    try {
      const tops = [
        { categoryCode: "TOP-COMIDAS", name: "Comidas", parentCategoryCode: null, active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "TOP-BEBIDAS", name: "Bebidas", parentCategoryCode: null, active: true, sortOrder: 1, kdsDestination: "bar", easyMode: false, foodType: "bebidas" },
        { categoryCode: "TOP-POSTRES", name: "Postres", parentCategoryCode: null, active: true, sortOrder: 2, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
      ];
      const subcats = [
        { categoryCode: "COM-PLATOS", name: "Platos Fuertes", parentCategoryCode: "TOP-COMIDAS", active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "COM-ANTOJOS", name: "Antojos", parentCategoryCode: "TOP-COMIDAS", active: true, sortOrder: 1, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "COM-CARNES", name: "Carnes", parentCategoryCode: "TOP-COMIDAS", active: true, sortOrder: 2, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "COM-DESAYUNO", name: "Desayuno", parentCategoryCode: "TOP-COMIDAS", active: true, sortOrder: 3, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "BEB-NATURALES", name: "Bebidas Naturales", parentCategoryCode: "TOP-BEBIDAS", active: true, sortOrder: 0, kdsDestination: "bar", easyMode: false, foodType: "bebidas" },
        { categoryCode: "BEB-GASEOSAS", name: "Gaseosas", parentCategoryCode: "TOP-BEBIDAS", active: true, sortOrder: 1, kdsDestination: "bar", easyMode: false, foodType: "bebidas" },
        { categoryCode: "BEB-CALIENTES", name: "Bebidas Calientes", parentCategoryCode: "TOP-BEBIDAS", active: true, sortOrder: 2, kdsDestination: "bar", easyMode: false, foodType: "bebidas" },
        { categoryCode: "BEB-ALCOHOL", name: "Alcohol y Cerveza", parentCategoryCode: "TOP-BEBIDAS", active: true, sortOrder: 3, kdsDestination: "bar", easyMode: false, foodType: "bebidas" },
        { categoryCode: "POS-DULCES", name: "Postres Dulces", parentCategoryCode: "TOP-POSTRES", active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "POS-SALADOS", name: "Salados", parentCategoryCode: "TOP-POSTRES", active: true, sortOrder: 1, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
        { categoryCode: "POS-DULCERIA", name: "Dulces", parentCategoryCode: "TOP-POSTRES", active: true, sortOrder: 2, kdsDestination: "cocina", easyMode: false, foodType: "comidas" },
      ];
      const existing = await storage.getAllCategories(req.db);
      const created: any[] = [];
      for (const item of [...tops, ...subcats]) {
        const exists = existing.find(c => c.categoryCode === item.categoryCode);
        if (!exists) {
          const cat = await storage.createCategory(item, req.db);
          created.push(cat);
        } else {
          created.push(exists);
        }
      }
      res.json({ message: `TOPs y subcategorías listos (${created.length})`, tops: created.filter((c: any) => c.categoryCode.startsWith("TOP-")), subcategories: created.filter((c: any) => !c.categoryCode.startsWith("TOP-")) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/categories", requireRole("MANAGER"), async (req, res) => {
    try {
      const cat = await storage.createCategory(req.body, req.db);
      res.json(cat);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/categories/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const cat = await storage.updateCategory(parseInt(req.params.id as string), req.body, req.db);
      res.json(cat);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PRODUCTS ====================
  app.get("/api/admin/products", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    res.json(await storage.getAllProducts(req.db));
  });

  app.post("/api/admin/products", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      if (!req.body.description || req.body.description.trim() === "") {
        return res.status(400).json({ message: "La descripción es obligatoria" });
      }
      const product = await storage.createProduct(req.body, req.db);
      res.json(product);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/products/:id", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      if (req.body.description !== undefined && req.body.description.trim() === "") {
        return res.status(400).json({ message: "La descripción es obligatoria" });
      }
      const product = await storage.updateProduct(parseInt(req.params.id as string), req.body, req.db);
      res.json(product);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/admin/products/:id", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const existing = await storage.getProduct(id, req.db);
      if (!existing) return res.status(404).json({ message: "Producto no encontrado" });
      const result = await storage.smartDeleteProduct(id, req.db);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PAYMENT METHODS ====================
  app.get("/api/admin/payment-methods", requireRole("MANAGER"), async (req, res) => {
    res.json(await storage.getAllPaymentMethods(req.db));
  });

  app.post("/api/admin/payment-methods", requireRole("MANAGER"), async (req, res) => {
    try {
      const pm = await storage.createPaymentMethod(req.body, req.db);
      res.json(pm);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/payment-methods/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const pm = await storage.updatePaymentMethod(parseInt(req.params.id as string), req.body, req.db);
      res.json(pm);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // ==================== ADMIN: BUSINESS CONFIG ====================
  app.get("/api/admin/business-config", requireRole("MANAGER"), async (req, res) => {
    try {
      const config = await storage.getBusinessConfig(req.tenantSchema);
      res.json(config || {});
    } catch (error) {
      console.error('[business-config GET]', error);
      res.status(500).json({ message: 'Error al cargar configuración' });
    }
  });

  app.put("/api/admin/business-config", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertBusinessConfigSchema.parse(req.body);
      const config = await storage.upsertBusinessConfig(parsed, req.tenantSchema);
      invalidateTimezoneCache(req.tenantSchema);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Also expose business config for receipt printing (CASHIER + WAITER + MANAGER)
  app.get("/api/business-config", requireAuth, async (req, res) => {
    const config = await storage.getBusinessConfig(req.tenantSchema);
    res.json(config || { businessName: "", legalName: "", taxId: "", address: "", phone: "", email: "", legalNote: "" });
  });

  // ==================== ADMIN: PRINTERS ====================
  app.get("/api/admin/printers", requireRole("MANAGER"), async (req, res) => {
    try {
      const list = await req.db.select().from(printersTable).orderBy(asc(printersTable.name));
      res.json(list);
    } catch (err: any) {
      console.error("[printers] GET error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/printers", requireRole("MANAGER"), async (req, res) => {
    try {
      const body = { ...req.body };
      if (!body.bridgeId || body.bridgeId === "none") body.bridgeId = null;
      const parsed = insertPrinterSchema.parse({
        ...body,
        port: Number(body.port) || 9100,
        paperWidth: Number(body.paperWidth) || 80,
      });
      const [printer] = await req.db.insert(printersTable).values(parsed).returning();
      res.status(201).json(printer);
    } catch (err: any) {
      console.error("[printers] POST error:", err.message);
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/printers/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.port !== undefined) data.port = Number(data.port) || 9100;
      if (data.paperWidth !== undefined) data.paperWidth = Number(data.paperWidth) || 80;
      if (data.bridgeId !== undefined) data.bridgeId = data.bridgeId || null;
      const [printer] = await req.db.update(printersTable).set(data).where(eq(printersTable.id, parseInt(req.params.id as string))).returning();
      if (!printer) return res.status(404).json({ message: "Impresora no encontrada" });
      res.json(printer);
    } catch (err: any) {
      console.error("[printers] PATCH error:", err.message);
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/admin/printers/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      await req.db.delete(printersTable).where(eq(printersTable.id, parseInt(req.params.id as string)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[printers] DELETE error:", err.message);
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: MODIFIERS ====================
  app.get("/api/admin/modifier-groups", requireRole("MANAGER"), async (req, res) => {
    const groups = await storage.getAllModifierGroups(req.db);
    const result = [];
    for (const g of groups) {
      const options = await storage.getModifierOptionsByGroup(g.id, req.db);
      result.push({ ...g, options });
    }
    res.json(result);
  });

  app.post("/api/admin/modifier-groups", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertModifierGroupSchema.parse(req.body);
      const group = await storage.createModifierGroup(parsed, req.db);
      res.json(group);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/modifier-groups/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const group = await storage.updateModifierGroup(parseInt(req.params.id as string), req.body, req.db);
      res.json(group);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/modifier-groups/:id/options", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertModifierOptionSchema.parse({
        ...req.body,
        groupId: parseInt(req.params.id as string),
      });
      const option = await storage.createModifierOption(parsed, req.db);
      res.json(option);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/modifier-options/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const option = await storage.updateModifierOption(parseInt(req.params.id as string), req.body, req.db);
      res.json(option);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/admin/modifier-options/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      await storage.deleteModifierOption(parseInt(req.params.id as string), req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: DISCOUNTS ====================
  app.get("/api/admin/discounts", requireRole("MANAGER"), async (req, res) => {
    res.json(await storage.getAllDiscounts(req.db));
  });

  app.post("/api/admin/discounts", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertDiscountSchema.parse(req.body);
      const discount = await storage.createDiscount(parsed, req.db);
      res.json(discount);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/discounts/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const discount = await storage.updateDiscount(parseInt(req.params.id as string), req.body, req.db);
      res.json(discount);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: TAX CATEGORIES ====================
  app.get("/api/admin/tax-categories", requireRole("MANAGER"), async (req, res) => {
    res.json(await storage.getAllTaxCategories(req.db));
  });

  app.post("/api/admin/tax-categories", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertTaxCategorySchema.parse(req.body);
      const tc = await storage.createTaxCategory(parsed, req.db);
      res.json(tc);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/tax-categories/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const tc = await storage.updateTaxCategory(parseInt(req.params.id as string), req.body, req.db);
      res.json(tc);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/recalc-open-orders", requireRole("MANAGER"), async (req, res) => {
    try {
      const openOrders = await storage.getOpenOrders(req.db);
      let recalced = 0;
      for (const order of openOrders) {
        await storage.recalcOrderTotal(order.id, req.db);
        recalced++;
      }
      res.json({ message: `${recalced} órdenes recalculadas`, recalced });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/tax-categories/:id/apply-all", requireRole("MANAGER"), async (req, res) => {
    try {
      const taxCategoryId = parseInt(req.params.id as string);
      const tc = await storage.getTaxCategory(taxCategoryId, req.db);
      if (!tc) return res.status(404).json({ message: "Impuesto no encontrado" });
      const result = await storage.applyTaxToAllProducts(taxCategoryId, req.db);
      const openOrders = await storage.getOpenOrders(req.db);
      let recalced = 0;
      for (const order of openOrders) {
        await storage.recalcOrderTotal(order.id, req.db);
        recalced++;
      }
      res.json({ ...result, ordersRecalculated: recalced });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Product tax assignment
  app.get("/api/admin/products/:id/taxes", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    const ptcs = await storage.getProductTaxCategories(parseInt(req.params.id as string), req.db);
    res.json(ptcs.map(p => p.taxCategoryId));
  });

  app.put("/api/admin/products/:id/taxes", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      const { taxCategoryIds } = req.body;
      if (!Array.isArray(taxCategoryIds)) return res.status(400).json({ message: "taxCategoryIds debe ser un array" });
      await storage.setProductTaxCategories(parseInt(req.params.id as string), taxCategoryIds, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== POS: DISCOUNTS LIST ====================
  app.get("/api/pos/discounts", requirePermission("POS_PAY"), async (req, res) => {
    const all = await storage.getAllDiscounts(req.db);
    res.json(all.filter(d => d.active));
  });

  // ==================== POS: BULK APPLY DISCOUNT TO ALL ITEMS ====================
  app.post("/api/pos/orders/:orderId/discount-all", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const { discountName, discountType, discountValue } = req.body;
      const userId = req.session.userId!;

      if (!discountName || typeof discountName !== "string") return res.status(400).json({ message: "Nombre de descuento requerido" });
      if (discountType !== "percentage" && discountType !== "fixed") return res.status(400).json({ message: "Tipo de descuento inválido" });
      const numValue = Number(discountValue);
      if (isNaN(numValue) || numValue <= 0) return res.status(400).json({ message: "Valor de descuento inválido" });
      if (discountType === "percentage" && numValue > 100) return res.status(400).json({ message: "Porcentaje no puede ser mayor a 100" });

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const items = await storage.getOrderItems(orderId, req.db);
      const activeItems = items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");

      for (const orderItem of activeItems) {
        const mods = await storage.getOrderItemModifiers(orderItem.id, req.db);
        const unitPrice = Number(orderItem.productPriceSnapshot) + mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        const lineSubtotal = unitPrice * orderItem.qty;

        let amountApplied = 0;
        if (discountType === "percentage") {
          amountApplied = Math.round(lineSubtotal * Number(discountValue) / 100 * 100) / 100;
        } else {
          amountApplied = Math.min(Number(discountValue), lineSubtotal);
        }

        await storage.deleteOrderItemDiscountsByItem(orderItem.id, req.db);
        await storage.createOrderItemDiscount({
          orderItemId: orderItem.id,
          orderId,
          discountName,
          discountType,
          discountValue: discountValue.toString(),
          amountApplied: amountApplied.toFixed(2),
          appliedByUserId: userId,
        }, req.db);
      }

      await storage.recalcOrderTotal(orderId, req.db);
      broadcast("order_updated", { orderId });

      res.json({ ok: true, itemsAffected: activeItems.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ITEM DISCOUNTS ====================
  app.post("/api/pos/order-items/:id/discount", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderItemId = parseInt(req.params.id as string);
      const { discountName, discountType, discountValue } = req.body;
      const userId = req.session.userId!;

      const orderItem = await storage.getOrderItem(orderItemId, req.db);
      if (!orderItem) return res.status(404).json({ message: "Item no encontrado" });

      const mods = await storage.getOrderItemModifiers(orderItemId, req.db);
      const unitPrice = Number(orderItem.productPriceSnapshot) + mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
      const lineSubtotal = unitPrice * orderItem.qty;

      let amountApplied = 0;
      if (discountType === "percentage") {
        amountApplied = Math.round(lineSubtotal * Number(discountValue) / 100 * 100) / 100;
      } else {
        amountApplied = Math.min(Number(discountValue), lineSubtotal);
      }

      await storage.deleteOrderItemDiscountsByItem(orderItemId, req.db);

      const discount = await storage.createOrderItemDiscount({
        orderItemId,
        orderId: orderItem.orderId,
        discountName,
        discountType,
        discountValue: discountValue.toString(),
        amountApplied: amountApplied.toFixed(2),
        appliedByUserId: userId,
      }, req.db);

      await storage.recalcOrderTotal(orderItem.orderId, req.db);
      broadcast("order_updated", { orderId: orderItem.orderId });

      res.json(discount);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/pos/order-items/:id/discount", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderItemId = parseInt(req.params.id as string);
      const orderItem = await storage.getOrderItem(orderItemId, req.db);
      if (!orderItem) return res.status(404).json({ message: "Item no encontrado" });

      await storage.deleteOrderItemDiscountsByItem(orderItemId, req.db);
      await storage.recalcOrderTotal(orderItem.orderId, req.db);
      broadcast("order_updated", { orderId: orderItem.orderId });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ADD ITEMS TO ORDER ====================
  app.post("/api/pos/orders/:orderId/add-items", requirePermission("MODULE_POS_VIEW"), async (req, res) => {
    const t0 = Date.now();
    try {
      const orderId = parseInt(req.params.orderId as string);
      const userId = req.session.userId!;
      const { items, sendToKds } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const table = order.tableId ? await storage.getTable(order.tableId, req.db) : null;
      const tableId = order.tableId || 0;
      const tableName = table?.tableName || "Mostrador";

      const productIds: number[] = Array.from(new Set(items.map((i: any) => i.productId as number)));

      const [existingItems, allCategories, allProductsList, allPtcs, allTaxCats] = await Promise.all([
        storage.getOrderItems(order.id, req.db),
        storage.getAllCategories(req.db),
        storage.getProductsByIds(productIds, req.db),
        storage.getProductTaxCategoriesByProductIds(productIds, req.db),
        storage.getAllTaxCategories(req.db),
      ]);

      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const productsById = new Map(allProductsList.map(p => [p.id, p]));
      const ptcsByProductId = new Map<number, typeof allPtcs>();
      for (const ptc of allPtcs) {
        if (!ptcsByProductId.has(ptc.productId)) ptcsByProductId.set(ptc.productId, []);
        ptcsByProductId.get(ptc.productId)!.push(ptc);
      }
      const taxCatsById = new Map(allTaxCats.map(tc => [tc.id, tc]));

      const kdsTickets: Map<string, number> = new Map();
      const createdTicketIds: number[] = [];
      const bd = await getBusinessDate(req.tenantSchema);

      for (const item of items) {
        const product = productsById.get(item.productId);
        if (!product || !product.active) continue;

        if (product.availablePortions !== null && product.availablePortions < item.qty) {
          return res.status(400).json({ message: `${product.name}: solo ${product.availablePortions} porciones disponibles` });
        }

        const category = allCategories.find(c => c.id === product.categoryId);
        const kdsDestination = category?.kdsDestination || "cocina";

        if (sendToKds && !kdsTickets.has(kdsDestination)) {
          const ticket = await storage.createKitchenTicket({
            orderId: order.id,
            tableId,
            tableNameSnapshot: tableName,
            status: "NEW",
            kdsDestination,
          }, req.db);
          kdsTickets.set(kdsDestination, ticket.id);
          createdTicketIds.push(ticket.id);
        }

        const orderItem = await storage.createOrderItem({
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          productPriceSnapshot: product.price,
          qty: item.qty,
          notes: item.notes || null,
          origin: "POS",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: sendToKds ? "SENT" : "OPEN",
          roundNumber,
          qrSubmissionId: null,
        }, req.db);

        const posTaxLinks = ptcsByProductId.get(product.id) || [];
        if (posTaxLinks.length > 0) {
          const taxSnapshot = posTaxLinks.map(ptc => {
            const tc = taxCatsById.get(ptc.taxCategoryId);
            return tc && tc.active ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot }, req.db);
          }
        }

        if (sendToKds) {
          try {
            await onOrderItemsConfirmedSent(order.id, [orderItem.id], userId);
          } catch (deductionErr: any) {
            await storage.updateOrderItem(orderItem.id, { status: "OPEN" }, req.db);
            return res.status(400).json({ message: deductionErr.message || "Error de inventario al enviar" });
          }

          await storage.updateOrderItem(orderItem.id, { sentToKitchenAt: new Date() }, req.db);

          const ticketId = kdsTickets.get(kdsDestination)!;
          const modNotes = item.modifiers && item.modifiers.length > 0
            ? item.modifiers.map((m: any) => m.name).join(", ")
            : "";
          const fullNotes = [item.notes, modNotes].filter(Boolean).join(" | ");

          if (item.qty > 1) {
            const groupId = crypto.randomUUID();
            for (let seq = 1; seq <= item.qty; seq++) {
              await storage.createKitchenTicketItem({
                kitchenTicketId: ticketId,
                orderItemId: orderItem.id,
                productNameSnapshot: product.name,
                qty: 1,
                notes: fullNotes || null,
                status: "NEW",
                kitchenItemGroupId: groupId,
                seqInGroup: seq,
              }, req.db);
            }
          } else {
            await storage.createKitchenTicketItem({
              kitchenTicketId: ticketId,
              orderItemId: orderItem.id,
              productNameSnapshot: product.name,
              qty: 1,
              notes: fullNotes || null,
              status: "NEW",
            }, req.db);
          }
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const mod of item.modifiers) {
            await storage.createOrderItemModifier({
              orderItemId: orderItem.id,
              modifierOptionId: mod.optionId,
              nameSnapshot: mod.name,
              priceDeltaSnapshot: mod.priceDelta || "0",
              qty: mod.qty || 1,
            }, req.db);
          }
        }

        const posModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const posUnitWithMods = Number(product.price) + posModDelta;

        await storage.createSalesLedgerItem({
          businessDate: bd,
          tableId,
          tableNameSnapshot: tableName,
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: product.id,
          productCodeSnapshot: product.productCode,
          productNameSnapshot: product.name,
          categoryId: product.categoryId,
          categoryCodeSnapshot: category?.categoryCode || null,
          categoryNameSnapshot: category?.name || null,
          qty: item.qty,
          unitPrice: posUnitWithMods.toFixed(2),
          lineSubtotal: (posUnitWithMods * item.qty).toFixed(2),
          origin: "POS",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: sendToKds ? "SENT" : "OPEN",
          sentToKitchenAt: sendToKds ? new Date() : null,
        });

        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: userId,
          action: "ORDER_ITEM_CREATED",
          entityType: "order_item",
          entityId: orderItem.id,
          tableId,
          metadata: { productName: product.name, qty: item.qty, origin: "POS", sendToKds },
        });
      }

      if (sendToKds) {
        await storage.updateOrder(order.id, { status: "IN_KITCHEN" }, req.db);
      }
      await storage.recalcOrderTotal(order.id, req.db);

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId, tableName });
      }
      broadcast("order_updated", { tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId });

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/orders/${orderId}/add-items ${Date.now() - t0}ms (${items.length} items)`);
      res.json({ ok: true, ticketIds: createdTicketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: TABLES ====================
  app.get("/api/waiter/tables", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const t0 = Date.now();
    const [allTables, allOpenOrders] = await Promise.all([
      storage.getAllTables(false, req.db),
      storage.getAllOpenOrders(req.db),
    ]);

    const parentOrders = allOpenOrders.filter(o => !o.parentOrderId && o.tableId);
    const orderByTable = new Map<number, typeof parentOrders[0]>();
    for (const o of parentOrders) {
      if (!orderByTable.has(o.tableId!)) orderByTable.set(o.tableId!, o);
    }

    const orderIds = parentOrders.map(o => o.id);
    const waiterIds = Array.from(new Set(parentOrders.filter(o => o.responsibleWaiterId).map(o => o.responsibleWaiterId!)));

    const tzSnap = await getTenantTimezone(req.tenantSchema);
    const crNow = getNowInTZ(tzSnap);
    const todayStr = `${crNow.getFullYear()}-${String(crNow.getMonth() + 1).padStart(2, '0')}-${String(crNow.getDate()).padStart(2, '0')}`;
    const tomorrowDate = new Date(crNow);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
    const yesterdayDate = new Date(crNow);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

    const [allItems, allSubs, waiters, upcomingReservations, allSubaccounts] = await Promise.all([
      storage.getOrderItemsByOrderIds(orderIds, req.db),
      storage.getPendingSubmissionsByOrderIds(orderIds, req.db),
      storage.getUsersByIds(waiterIds, req.db),
      req.db.select().from(reservations).where(and(
        inArray(reservations.status, ['PENDING', 'CONFIRMED', 'SEATED']),
        or(eq(reservations.reservedDate, yesterdayStr), eq(reservations.reservedDate, todayStr), eq(reservations.reservedDate, tomorrowStr)),
      )),
      orderIds.length > 0
        ? req.db.select().from(orderSubaccounts).where(and(inArray(orderSubaccounts.orderId, orderIds), eq(orderSubaccounts.isActive, true)))
        : Promise.resolve([]),
    ]);

    const waiterMap = new Map(waiters.map(w => [w.id, w.displayName]));

    const itemsByOrder = new Map<number, typeof allItems>();
    for (const item of allItems) {
      if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
      itemsByOrder.get(item.orderId)!.push(item);
    }

    const subsByOrder = new Map<number, number>();
    for (const s of allSubs) {
      subsByOrder.set(s.orderId, (subsByOrder.get(s.orderId) || 0) + 1);
    }

    const subaccountNamesByOrder = new Map<number, string[]>();
    for (const sa of allSubaccounts) {
      if (sa.label) {
        if (!subaccountNamesByOrder.has(sa.orderId)) subaccountNamesByOrder.set(sa.orderId, []);
        subaccountNamesByOrder.get(sa.orderId)!.push(sa.label);
      }
    }

    const currentMinutes = crNow.getHours() * 60 + crNow.getMinutes();

    const result = allTables.map(t => {
      const order = orderByTable.get(t.id);
      let waiterName: string | null = null;
      let pendingQrCount = 0;
      let itemCount = 0;
      let lastSentToKitchenAt: string | null = null;

      if (order) {
        waiterName = order.responsibleWaiterId ? (waiterMap.get(order.responsibleWaiterId) || null) : null;
        pendingQrCount = subsByOrder.get(order.id) || 0;
        const items = itemsByOrder.get(order.id) || [];
        itemCount = items.filter(i => i.status !== "VOIDED").length;
        const sentTimes = items
          .filter(i => i.status !== "VOIDED" && i.sentToKitchenAt)
          .map(i => new Date(i.sentToKitchenAt!).getTime());
        if (sentTimes.length > 0) {
          lastSentToKitchenAt = new Date(Math.max(...sentTimes)).toISOString();
        }
      }

      let upcomingReservation: any = null;
      let hasActiveReservation = false;
      const tableReservations = upcomingReservations
        .filter(r => reservationCoversTable(r, t.id))
        .map(r => {
          const rDate = r.reservedDate as string;
          const rTime = r.reservedTime as string;
          const [rh, rm] = rTime.split(':').map(Number);
          let minutesUntil: number;
          if (rDate === todayStr) {
            minutesUntil = (rh * 60 + rm) - currentMinutes;
          } else {
            minutesUntil = (24 * 60 - currentMinutes) + (rh * 60 + rm);
          }
          return { ...r, minutesUntil };
        })
        .filter(r => r.minutesUntil > -30 && r.minutesUntil <= 24 * 60)
        .sort((a, b) => a.minutesUntil - b.minutesUntil);

      if (tableReservations.length > 0) {
        const nearest = tableReservations[0];
        upcomingReservation = {
          id: nearest.id,
          guestName: nearest.guestName,
          partySize: nearest.partySize,
          reservedDate: nearest.reservedDate,
          reservedTime: nearest.reservedTime,
          status: nearest.status,
          minutesUntil: nearest.minutesUntil,
        };
      }

      const relevantTableRes = upcomingReservations.filter(r =>
        reservationCoversTable(r, t.id) && (r.reservedDate === todayStr || r.reservedDate === yesterdayStr)
      );
      for (const r of relevantTableRes) {
        const rTime = r.reservedTime as string;
        const rStart = timeToMinutes(rTime);
        const rEnd = rStart + r.durationMinutes;
        if (r.reservedDate === todayStr) {
          if (currentMinutes >= rStart && currentMinutes < rEnd) {
            hasActiveReservation = true;
            break;
          }
        } else {
          const endMinutes = rEnd;
          if (endMinutes > 1440 && currentMinutes < (endMinutes - 1440)) {
            hasActiveReservation = true;
            break;
          }
        }
      }

      return {
        id: t.id,
        tableCode: t.tableCode,
        tableName: t.tableName,
        active: t.active,
        hasOpenOrder: !!order,
        orderId: order?.id || null,
        orderStatus: order?.status || null,
        dailyNumber: order?.dailyNumber || null,
        responsibleWaiterName: waiterName,
        openedAt: order?.openedAt?.toISOString() || null,
        pendingQrCount,
        itemCount,
        totalAmount: order ? (Number(order.totalAmount) > 0 ? order.balanceDue : order.totalAmount) : null,
        lastSentToKitchenAt,
        upcomingReservation,
        hasActiveReservation,
        subaccountNames: order ? (subaccountNamesByOrder.get(order.id) || []) : [],
        transactionCode: (order as any)?.transactionCode || null,
      };
    });
    const quickSaleOrders = allOpenOrders.filter(o => o.isQuickSale && !o.parentOrderId);
    const quickSaleResults = quickSaleOrders.map(o => {
      const waiterName = o.responsibleWaiterId ? (waiterMap.get(o.responsibleWaiterId) || null) : null;
      const items = itemsByOrder.get(o.id) || [];
      const itemCount = items.filter(i => i.status !== "VOIDED").length;
      const sentTimes = items.filter(i => i.status !== "VOIDED" && i.sentToKitchenAt).map(i => new Date(i.sentToKitchenAt!).getTime());
      const lastSentToKitchenAt = sentTimes.length > 0 ? new Date(Math.max(...sentTimes)).toISOString() : null;
      return {
        id: -(o.id),
        tableCode: `QS-${o.id}`,
        tableName: o.quickSaleName || `Rápida #${o.dailyNumber}`,
        active: true,
        hasOpenOrder: true,
        orderId: o.id,
        orderStatus: o.status,
        dailyNumber: o.dailyNumber,
        responsibleWaiterName: waiterName,
        openedAt: o.openedAt?.toISOString() || null,
        pendingQrCount: 0,
        itemCount,
        totalAmount: Number(o.totalAmount) > 0 ? o.balanceDue : o.totalAmount,
        lastSentToKitchenAt,
        upcomingReservation: null,
        hasActiveReservation: false,
        subaccountNames: [],
        isQuickSale: true,
        transactionCode: (o as any).transactionCode || null,
      };
    });

    if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/waiter/tables ${Date.now() - t0}ms (${allTables.length} tables)`);
    res.json([...result, ...quickSaleResults]);
  });

  app.get("/api/waiter/tables/:id", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const table = await storage.getTable(parseInt(req.params.id as string), req.db);
    if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
    res.json(table);
  });

  app.get("/api/tables/quick/:orderId/current", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const order = await storage.getOrder(orderId, req.db);
      if (!order || !order.isQuickSale) return res.status(404).json({ message: "Venta rápida no encontrada" });

      const virtualTable = {
        id: null,
        tableCode: `QS-${orderId}`,
        tableName: order.quickSaleName || `Venta Rápida #${order.dailyNumber}`,
        active: true,
        capacity: 0,
        isQuickSale: true,
        orderId,
      };

      const [items, voidedItemsList, allMods] = await Promise.all([
        storage.getOrderItems(orderId, req.db),
        storage.getVoidedItemsForOrder(orderId, req.db),
        storage.getOrderItemModifiersByOrderIds([orderId], req.db),
      ]);

      const modsByItem = new Map<number, typeof allMods>();
      for (const m of allMods) {
        if (!modsByItem.has(m.orderItemId)) modsByItem.set(m.orderItemId, []);
        modsByItem.get(m.orderItemId)!.push(m);
      }
      const itemsWithMods = items.map(item => ({ ...item, modifiers: modsByItem.get(item.id) || [] }));

      const voidedUserIds = Array.from(new Set(voidedItemsList.map(i => i.voidedByUserId).filter((id): id is number => id != null)));
      const voidedUsers = await storage.getUsersByIds(voidedUserIds, req.db);
      const voidedUsersMap = new Map<number, string>();
      for (const u of voidedUsers) voidedUsersMap.set(u.id, u.displayName);
      const voidedItemsWithNames = voidedItemsList.map(i => ({
        ...i,
        voidedAt: i.voidedAt?.toISOString() || null,
        voidedByName: voidedUsersMap.get(i.voidedByUserId) || "Desconocido",
      }));

      res.json({ table: virtualTable, activeOrder: order, orderItems: itemsWithMods, pendingQrSubmissions: [], voidedItems: voidedItemsWithNames });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tables/:id/current", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const t0 = Date.now();
    try {
      const tableId = parseInt(req.params.id as string);
      const table = await storage.getTable(tableId, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await storage.getOpenOrderForTable(tableId, req.db);
      if (!order) {
        return res.json({ table, activeOrder: null, orderItems: [], pendingQrSubmissions: [] });
      }

      const [items, pendingSubs, voidedItemsList, allMods] = await Promise.all([
        storage.getOrderItems(order.id, req.db),
        storage.getPendingSubmissions(order.id, req.db),
        storage.getVoidedItemsForOrder(order.id, req.db),
        storage.getOrderItemModifiersByOrderIds([order.id], req.db),
      ]);

      const voidedUserIds = Array.from(new Set(voidedItemsList.map(i => i.voidedByUserId)));
      const voidedUsers = await storage.getUsersByIds(voidedUserIds, req.db);

      const modsByItem = new Map<number, typeof allMods>();
      for (const m of allMods) {
        if (!modsByItem.has(m.orderItemId)) modsByItem.set(m.orderItemId, []);
        modsByItem.get(m.orderItemId)!.push(m);
      }
      const itemsWithMods = items.map(item => ({
        ...item,
        modifiers: modsByItem.get(item.id) || [],
      }));

      const subsWithItems = [];
      for (const sub of pendingSubs) {
        const subItems = itemsWithMods.filter(i => i.qrSubmissionId === sub.id);
        subsWithItems.push({ ...sub, items: subItems });
      }

      const voidedUsersMap = new Map<number, string>();
      for (const u of voidedUsers) voidedUsersMap.set(u.id, u.displayName);
      const voidedItemsWithNames = voidedItemsList.map(i => ({
        ...i,
        voidedAt: i.voidedAt?.toISOString() || null,
        voidedByName: voidedUsersMap.get(i.voidedByUserId) || "Desconocido",
      }));

      if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/tables/${tableId}/current ${Date.now() - t0}ms`);
      res.json({ table, activeOrder: order, orderItems: itemsWithMods, pendingQrSubmissions: subsWithItems, voidedItems: voidedItemsWithNames });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/orders/:id/guest-count", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.id as string);
      const guestCount = parseInt(req.body.guestCount);
      if (isNaN(orderId) || isNaN(guestCount) || guestCount < 1) {
        return res.status(400).json({ message: "Datos inválidos" });
      }
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      await storage.updateOrder(orderId, { guestCount }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tables/move", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const srcId = parseInt(req.body.sourceTableId);
      const dstId = parseInt(req.body.destTableId);
      if (isNaN(srcId) || isNaN(dstId)) return res.status(400).json({ message: "IDs de mesa inválidos" });
      if (srcId === dstId) return res.status(400).json({ message: "La mesa origen y destino no pueden ser la misma" });

      const sourceTable = await storage.getTable(srcId, req.db);
      const destTable = await storage.getTable(dstId, req.db);
      if (!sourceTable || !sourceTable.active) return res.status(404).json({ message: "Mesa origen no encontrada o inactiva" });
      if (!destTable || !destTable.active) return res.status(404).json({ message: "Mesa destino no encontrada o inactiva" });

      const sourceOrder = await storage.getOpenOrderForTable(srcId, req.db);
      if (!sourceOrder) return res.status(400).json({ message: "La mesa origen no tiene una orden abierta" });

      const destOrder = await storage.getOpenOrderForTable(dstId, req.db);
      if (destOrder) return res.status(400).json({ message: "La mesa destino ya tiene una orden abierta" });

      await req.db.transaction(async (tx) => {
        await tx.update(orders).set({ tableId: dstId }).where(eq(orders.id, sourceOrder.id));
        await tx.update(qrSubmissions).set({ tableId: dstId }).where(and(eq(qrSubmissions.orderId, sourceOrder.id), eq(qrSubmissions.tableId, srcId)));
        await tx.update(kitchenTickets).set({ tableId: dstId, tableNameSnapshot: destTable.tableName }).where(and(eq(kitchenTickets.orderId, sourceOrder.id), eq(kitchenTickets.tableId, srcId)));
      });

      broadcast("table_status_changed", { tableId: srcId });
      broadcast("table_status_changed", { tableId: dstId });
      broadcast("order_updated", { tableId: dstId, orderId: sourceOrder.id });
      broadcast("kds_refresh", {});

      res.json({ ok: true, message: `Mesa ${sourceTable.tableName} movida a ${destTable.tableName}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tables/move-subaccount", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subaccountId = parseInt(req.body.subaccountId);
      const destTableId = parseInt(req.body.destTableId);
      if (isNaN(subaccountId) || isNaN(destTableId)) return res.status(400).json({ message: "Parámetros inválidos" });

      const [subaccount] = await req.db.select().from(orderSubaccounts).where(eq(orderSubaccounts.id, subaccountId));
      if (!subaccount) return res.status(404).json({ message: "Subcuenta no encontrada" });

      const sourceOrder = await storage.getOrder(subaccount.orderId, req.db);
      if (!sourceOrder || sourceOrder.status === "CLOSED") return res.status(400).json({ message: "Orden origen no válida" });

      const sourceTable = await storage.getTable(sourceOrder.tableId!, req.db);
      const destTable = await storage.getTable(destTableId, req.db);
      if (!destTable || !destTable.active) return res.status(404).json({ message: "Mesa destino no encontrada o inactiva" });
      if (sourceOrder.tableId === destTableId) return res.status(400).json({ message: "La subcuenta ya está en esa mesa" });

      let destOrder = await storage.getOpenOrderForTable(destTableId, req.db);
      if (destOrder && !["OPEN", "IN_KITCHEN", "PREPARING", "READY"].includes(destOrder.status)) {
        return res.status(400).json({ message: "La orden destino no está activa" });
      }

      await req.db.transaction(async (tx) => {
        if (!destOrder) {
          const [newOrder] = await tx.insert(orders).values({
            tableId: destTableId,
            status: "OPEN",
            responsibleWaiterId: sourceOrder.responsibleWaiterId,
            businessDate: await getBusinessDateCR(req.tenantSchema),
          }).returning();
          destOrder = newOrder;
        }

        const subItems = await tx.select().from(orderItems)
          .where(and(eq(orderItems.orderId, sourceOrder.id), eq(orderItems.subaccountId, subaccountId)));

        const subItemIds = subItems.map(i => i.id);

        if (subItemIds.length > 0) {
          await tx.update(orderItems).set({ orderId: destOrder!.id })
            .where(inArray(orderItems.id, subItemIds));

          const relatedTicketItems = await tx.select().from(kitchenTicketItems)
            .where(inArray(kitchenTicketItems.orderItemId, subItemIds));
          const ticketIdSet = new Set(relatedTicketItems.map(ti => ti.kitchenTicketId));
          const ticketIds = Array.from(ticketIdSet);

          for (const ticketId of ticketIds) {
            const allTicketItems = await tx.select().from(kitchenTicketItems)
              .where(eq(kitchenTicketItems.kitchenTicketId, ticketId));
            const movedIds = new Set(subItemIds);
            const remainingItems = allTicketItems.filter(ti => !movedIds.has(ti.orderItemId));

            if (remainingItems.length === 0) {
              await tx.update(kitchenTickets).set({
                orderId: destOrder!.id,
                tableId: destTableId,
                tableNameSnapshot: destTable.tableName,
              }).where(eq(kitchenTickets.id, ticketId));
            } else {
              const movedItems = allTicketItems.filter(ti => movedIds.has(ti.orderItemId));
              if (movedItems.length > 0) {
                const [origTicket] = await tx.select().from(kitchenTickets).where(eq(kitchenTickets.id, ticketId));
                const [newTicket] = await tx.insert(kitchenTickets).values({
                  orderId: destOrder!.id,
                  tableId: destTableId,
                  tableNameSnapshot: destTable.tableName,
                  status: origTicket.status,
                  kdsDestination: origTicket.kdsDestination,
                }).returning();
                await tx.update(kitchenTicketItems).set({ kitchenTicketId: newTicket.id })
                  .where(inArray(kitchenTicketItems.id, movedItems.map(m => m.id)));
              }
            }
          }

          await tx.update(salesLedgerItems).set({ orderId: destOrder!.id, tableId: destTableId, tableNameSnapshot: destTable.tableName })
            .where(inArray(salesLedgerItems.orderItemId, subItemIds));
        }

        const relatedSubs = await tx.select().from(qrSubmissions)
          .where(eq(qrSubmissions.orderId, sourceOrder.id));
        for (const qs of relatedSubs) {
          const payload = qs.payloadSnapshot as any;
          if (payload?.subaccountId === subaccountId) {
            await tx.update(qrSubmissions).set({ orderId: destOrder!.id, tableId: destTableId })
              .where(eq(qrSubmissions.id, qs.id));
          }
        }

        await tx.update(orderSubaccounts).set({
          orderId: destOrder!.id,
          tableId: destTableId,
        }).where(eq(orderSubaccounts.id, subaccountId));
      });

      await storage.recalcOrderTotal(sourceOrder.id, req.db);
      await storage.recalcOrderTotal(destOrder!.id, req.db);

      broadcast("table_status_changed", { tableId: sourceOrder.tableId });
      broadcast("table_status_changed", { tableId: destTableId });
      broadcast("order_updated", { tableId: sourceOrder.tableId, orderId: sourceOrder.id });
      broadcast("order_updated", { tableId: destTableId, orderId: destOrder!.id });
      broadcast("kds_refresh", {});

      res.json({ ok: true, message: `Subcuenta "${subaccount.label}" movida de ${sourceTable?.tableName} a ${destTable.tableName}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/waiter/tables/:id/order", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const tableId = parseInt(req.params.id as string);
    const order = await storage.getOpenOrderForTable(tableId, req.db);
    if (!order) return res.json({ order: null, items: [], pendingSubmissions: [] });

    const items = await storage.getOrderItems(order.id, req.db);
    const pendingSubs = await storage.getPendingSubmissions(order.id, req.db);

    const subsWithItems = [];
    for (const sub of pendingSubs) {
      const subItems = items.filter(i => i.qrSubmissionId === sub.id);
      subsWithItems.push({ ...sub, items: subItems });
    }

    res.json({ order, items, pendingSubmissions: subsWithItems });
  });

  app.get("/api/waiter/menu", requireRole("WAITER", "MANAGER"), async (req, res) => {
    res.json(await storage.getActiveProducts(req.db));
  });

  app.get("/api/waiter/categories", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const allCats = await storage.getAllCategories(req.db);
    res.json(allCats.filter(c => c.active));
  });

  app.get("/api/products/:id/modifiers", async (req, res) => {
    try {
      const productId = parseInt(req.params.id as string);
      const links = await storage.getItemModifierGroups(productId, req.db);
      const groupIds = links.map(l => l.modifierGroupId);
      const [groups, allOptions] = await Promise.all([
        Promise.all(groupIds.map(id => storage.getModifierGroup(id, req.db))),
        Promise.all(groupIds.map(id => storage.getModifierOptionsByGroup(id, req.db))),
      ]);
      const result = [];
      for (let i = 0; i < links.length; i++) {
        const group = groups[i];
        if (!group || !group.active) continue;
        result.push({
          ...group,
          options: (allOptions[i] || []).filter((o: any) => o.active),
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Waiter: Send round to kitchen
  app.post("/api/waiter/tables/:id/send-round", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const tableId = parseInt(req.params.id as string);
      const userId = req.session.userId!;
      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const productIds = Array.from(new Set(items.map((i: any) => i.productId))) as number[];

      const [table, allProducts, allCategories, allTaxCats, allProdTaxLinks] = await Promise.all([
        storage.getTable(tableId, req.db),
        storage.getProductsByIds(productIds, req.db),
        storage.getAllCategories(req.db),
        storage.getAllTaxCategories(req.db),
        Promise.all(productIds.map(pid => storage.getProductTaxCategories(pid, req.db).then(links => ({ pid, links })))),
      ]);

      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const productMap = new Map(allProducts.map(p => [p.id, p]));
      const taxLinksMap = new Map(allProdTaxLinks.map(r => [r.pid, r.links]));

      let order = await getOrCreateOrderForTable(tableId, userId, req.tenantSchema, req.db);

      const [existingItems] = await Promise.all([
        storage.getOrderItems(order.id, req.db),
        !order.responsibleWaiterId ? storage.updateOrder(order.id, { responsibleWaiterId: userId }, req.db).then(o => { order = o; }) : Promise.resolve(),
      ]);

      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const qtyByProduct = new Map<number, number>();
      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product || !product.active) continue;
        qtyByProduct.set(product.id, (qtyByProduct.get(product.id) || 0) + item.qty);
      }
      for (const entry of Array.from(qtyByProduct.entries())) {
        const [pid, totalQty] = entry;
        const product = productMap.get(pid)!;
        if (product.availablePortions !== null && product.availablePortions < totalQty) {
          return res.status(400).json({ message: `${product.name}: solo ${product.availablePortions} porciones disponibles` });
        }
      }

      const kdsTickets: Map<string, number> = new Map();
      const createdTicketIds: number[] = [];
      const businessDate = await getBusinessDate(req.tenantSchema);
      const now = new Date();

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product || !product.active) continue;

        const category = allCategories.find(c => c.id === product.categoryId);
        const kdsDestination = category?.kdsDestination || "cocina";

        if (!kdsTickets.has(kdsDestination)) {
          const ticket = await storage.createKitchenTicket({
            orderId: order.id,
            tableId,
            tableNameSnapshot: table.tableName,
            status: "NEW",
            kdsDestination,
          }, req.db);
          kdsTickets.set(kdsDestination, ticket.id);
          createdTicketIds.push(ticket.id);
        }

        const ticketId = kdsTickets.get(kdsDestination)!;

        const waiterTaxLinks = taxLinksMap.get(product.id) || [];
        let taxSnapshot: any[] | null = null;
        if (waiterTaxLinks.length > 0) {
          taxSnapshot = waiterTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length === 0) taxSnapshot = null;
        }

        const orderItem = await storage.createOrderItem({
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          productPriceSnapshot: product.price,
          qty: item.qty,
          notes: item.notes || null,
          origin: "WAITER",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: "SENT",
          roundNumber,
          qrSubmissionId: null,
        }, req.db);

        const modNotes = item.modifiers && item.modifiers.length > 0
          ? item.modifiers.map((m: any) => m.name).join(", ")
          : "";
        const fullNotes = [item.notes, modNotes].filter(Boolean).join(" | ");
        const waiterModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const waiterUnitWithMods = Number(product.price) + waiterModDelta;

        const kdsItemOps: Promise<any>[] = [];
        if (item.qty > 1) {
          const groupId = crypto.randomUUID();
          for (let seq = 1; seq <= item.qty; seq++) {
            kdsItemOps.push(storage.createKitchenTicketItem({
              kitchenTicketId: ticketId,
              orderItemId: orderItem.id,
              productNameSnapshot: product.name,
              qty: 1,
              notes: fullNotes || null,
              status: "NEW",
              kitchenItemGroupId: groupId,
              seqInGroup: seq,
            }, req.db));
          }
        } else {
          kdsItemOps.push(storage.createKitchenTicketItem({
            kitchenTicketId: ticketId,
            orderItemId: orderItem.id,
            productNameSnapshot: product.name,
            qty: 1,
            notes: fullNotes || null,
            status: "NEW",
          }, req.db));
        }

        const parallelOps: Promise<any>[] = [
          storage.updateOrderItem(orderItem.id, { sentToKitchenAt: now, ...(taxSnapshot ? { taxSnapshotJson: taxSnapshot } : {}) }, req.db),
          ...kdsItemOps,
          storage.createSalesLedgerItem({
            businessDate,
            tableId,
            tableNameSnapshot: table.tableName,
            orderId: order.id,
            orderItemId: orderItem.id,
            productId: product.id,
            productCodeSnapshot: product.productCode,
            productNameSnapshot: product.name,
            categoryId: product.categoryId,
            categoryCodeSnapshot: category?.categoryCode || null,
            categoryNameSnapshot: category?.name || null,
            qty: item.qty,
            unitPrice: waiterUnitWithMods.toFixed(2),
            lineSubtotal: (waiterUnitWithMods * item.qty).toFixed(2),
            origin: "WAITER",
            createdByUserId: userId,
            responsibleWaiterId: userId,
            status: "OPEN",
            sentToKitchenAt: now,
          }),
          storage.createAuditEvent({
            actorType: "USER",
            actorUserId: userId,
            action: "ORDER_ITEM_CREATED",
            entityType: "order_item",
            entityId: orderItem.id,
            tableId,
            metadata: { productName: product.name, qty: item.qty },
          }),
        ];

        if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
          for (const mod of item.modifiers) {
            parallelOps.push(storage.createOrderItemModifier({
              orderItemId: orderItem.id,
              modifierOptionId: mod.optionId,
              nameSnapshot: mod.name,
              priceDeltaSnapshot: mod.priceDelta || "0",
              qty: mod.qty || 1,
            }, req.db));
          }
        }

        await Promise.all(parallelOps);

        try {
          await onOrderItemsConfirmedSent(order.id, [orderItem.id], userId);
        } catch (deductionErr: any) {
          console.error("[inv] deduction error:", deductionErr);
        }
      }

      await storage.updateOrder(order.id, { status: "IN_KITCHEN" }, req.db);
      await storage.recalcOrderTotal(order.id, req.db);

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId });

      res.json({ ok: true, ticketIds: createdTicketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: QUICK SALE ====================
  app.post("/api/waiter/quick-sale", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Nombre requerido" });

      const businessDate = await getBusinessDate(req.tenantSchema);
      let order = await storage.createOrder({
        tableId: null as any,
        status: "OPEN",
        responsibleWaiterId: req.session?.userId ?? null,
        businessDate,
        isQuickSale: true,
        quickSaleName: name.trim(),
      } as any, req.db);

      try {
        const txCode = await generateTransactionCode(req.db, businessDate);
        order = await storage.updateOrder(order.id, { transactionCode: txCode } as any, req.db);
      } catch (codeErr) {
        console.warn("[txCode] quick-sale:", codeErr);
      }

      res.status(201).json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/waiter/orders/:orderId/send-round", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const userId = req.session.userId!;
      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const productIds = Array.from(new Set(items.map((i: any) => i.productId))) as number[];

      const [order, allProducts, allCategories, allTaxCats, allProdTaxLinks] = await Promise.all([
        storage.getOrder(orderId, req.db),
        storage.getProductsByIds(productIds, req.db),
        storage.getAllCategories(req.db),
        storage.getAllTaxCategories(req.db),
        Promise.all(productIds.map(pid => storage.getProductTaxCategories(pid, req.db).then(links => ({ pid, links })))),
      ]);

      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const productMap = new Map(allProducts.map(p => [p.id, p]));
      const taxLinksMap = new Map(allProdTaxLinks.map(r => [r.pid, r.links]));

      if (!order.responsibleWaiterId) {
        await storage.updateOrder(orderId, { responsibleWaiterId: userId }, req.db);
      }

      const existingItems = await storage.getOrderItems(orderId, req.db);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const kdsTickets: Map<string, number> = new Map();
      const createdTicketIds: number[] = [];
      const businessDate = await getBusinessDate(req.tenantSchema);
      const now = new Date();
      const displayName = order.quickSaleName || `Orden #${order.dailyNumber}`;

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product || !product.active) continue;

        const category = allCategories.find(c => c.id === product.categoryId);
        const kdsDestination = category?.kdsDestination || "cocina";

        if (!kdsTickets.has(kdsDestination)) {
          const ticket = await storage.createKitchenTicket({
            orderId,
            tableId: null as any,
            tableNameSnapshot: displayName,
            status: "NEW",
            kdsDestination,
          }, req.db);
          kdsTickets.set(kdsDestination, ticket.id);
          createdTicketIds.push(ticket.id);
        }

        const kitchenTicketId = kdsTickets.get(kdsDestination)!;

        const waiterTaxLinks = taxLinksMap.get(product.id) || [];
        let taxSnapshot: any[] | null = null;
        if (waiterTaxLinks.length > 0) {
          taxSnapshot = waiterTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length === 0) taxSnapshot = null;
        }

        const modNotes = item.modifiers && item.modifiers.length > 0
          ? item.modifiers.map((m: any) => m.name).join(", ")
          : "";
        const fullNotes = [item.notes, modNotes].filter(Boolean).join(" | ");
        const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const unitWithMods = Number(product.price) + modDelta;

        const orderItem = await storage.createOrderItem({
          orderId,
          productId: product.id,
          productNameSnapshot: product.name,
          productPriceSnapshot: product.price,
          qty: item.qty,
          notes: item.notes || null,
          origin: "WAITER",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: "SENT",
          roundNumber,
          qrSubmissionId: null,
        }, req.db);

        const kdsItemOps: Promise<any>[] = [];
        if (item.qty > 1) {
          const groupId = crypto.randomUUID();
          for (let seq = 1; seq <= item.qty; seq++) {
            kdsItemOps.push(storage.createKitchenTicketItem({
              kitchenTicketId,
              orderItemId: orderItem.id,
              productNameSnapshot: product.name,
              qty: 1,
              notes: fullNotes || null,
              status: "NEW",
              kitchenItemGroupId: groupId,
              seqInGroup: seq,
            }, req.db));
          }
        } else {
          kdsItemOps.push(storage.createKitchenTicketItem({
            kitchenTicketId,
            orderItemId: orderItem.id,
            productNameSnapshot: product.name,
            qty: 1,
            notes: fullNotes || null,
            status: "NEW",
          }, req.db));
        }

        await Promise.all([
          storage.updateOrderItem(orderItem.id, { sentToKitchenAt: now, ...(taxSnapshot ? { taxSnapshotJson: taxSnapshot } : {}) }, req.db),
          ...kdsItemOps,
          storage.createSalesLedgerItem({
            businessDate,
            tableId: null as any,
            tableNameSnapshot: displayName,
            orderId,
            orderItemId: orderItem.id,
            productId: product.id,
            productCodeSnapshot: (product as any).productCode || null,
            productNameSnapshot: product.name,
            categoryId: product.categoryId,
            categoryCodeSnapshot: category?.categoryCode || null,
            categoryNameSnapshot: category?.name || null,
            qty: item.qty,
            unitPrice: unitWithMods.toFixed(2),
            lineSubtotal: (unitWithMods * item.qty).toFixed(2),
            origin: "WAITER",
            createdByUserId: userId,
            responsibleWaiterId: userId,
            status: "OPEN",
            sentToKitchenAt: now,
          }),
          storage.createAuditEvent({
            actorType: "USER",
            actorUserId: userId,
            action: "ORDER_ITEM_CREATED",
            entityType: "order_item",
            entityId: orderItem.id,
            tableId: null,
            metadata: { orderId, productId: product.id, qty: item.qty },
          }),
        ]);

        try {
          await onOrderItemsConfirmedSent(orderId, [orderItem.id], userId);
        } catch {}
      }

      await storage.updateOrder(orderId, { status: "IN_KITCHEN" }, req.db);
      await storage.recalcOrderTotal(orderId, req.db);

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId: null, tableName: displayName });
      }
      broadcast("order_updated", { tableId: null, orderId });

      res.json({ ok: true, ticketIds: createdTicketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: QR SUBMISSION ACCEPT ====================
  app.post("/api/waiter/qr-submissions/:id/accept", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id as string);
      const userId = req.session.userId!;
      const sub = await storage.getSubmission(subId, req.db);
      if (!sub || sub.status !== "PENDING") return res.status(400).json({ message: "Submission no válida" });

      const order = await storage.getOpenOrderForTable(sub.tableId, req.db);
      if (!order) return res.status(400).json({ message: "Orden no encontrada" });

      const table = await storage.getTable(sub.tableId, req.db);
      if (!table) return res.status(400).json({ message: "Mesa no encontrada" });

      // Update waiter on order if not set
      if (!order.responsibleWaiterId) {
        await storage.updateOrder(order.id, { responsibleWaiterId: userId }, req.db);
      }

      // Accept submission
      await storage.updateSubmission(subId, {
        status: "ACCEPTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      }, req.db);

      // Get pending items for this submission
      const orderItemsList = await storage.getOrderItems(order.id, req.db);
      const subItems = orderItemsList.filter(i => i.qrSubmissionId === subId);

      const createdTicketIds: number[] = [];

      if (subItems.length > 0) {
        const allCategories = await storage.getAllCategories(req.db);
        const allProducts = await Promise.all(subItems.map(i => storage.getProduct(i.productId, req.db)));
        const kdsTickets: Map<string, number> = new Map();

        for (let idx = 0; idx < subItems.length; idx++) {
          const item = subItems[idx];
          const product = allProducts[idx];
          const category = product ? allCategories.find(c => c.id === product.categoryId) : null;
          const kdsDestination = category?.kdsDestination || "cocina";

          if (!kdsTickets.has(kdsDestination)) {
            const ticket = await storage.createKitchenTicket({
              orderId: order.id,
              tableId: sub.tableId,
              tableNameSnapshot: table.tableName,
              status: "NEW",
              kdsDestination,
            }, req.db);
            kdsTickets.set(kdsDestination, ticket.id);
            createdTicketIds.push(ticket.id);
          }

          const ticketId = kdsTickets.get(kdsDestination)!;

          await storage.updateOrderItem(item.id, {
            status: "SENT",
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          }, req.db);

          if (item.qty > 1) {
            const groupId = crypto.randomUUID();
            for (let seq = 1; seq <= item.qty; seq++) {
              await storage.createKitchenTicketItem({
                kitchenTicketId: ticketId,
                orderItemId: item.id,
                productNameSnapshot: item.productNameSnapshot,
                qty: 1,
                notes: item.notes,
                status: "NEW",
                kitchenItemGroupId: groupId,
                seqInGroup: seq,
              }, req.db);
            }
          } else {
            await storage.createKitchenTicketItem({
              kitchenTicketId: ticketId,
              orderItemId: item.id,
              productNameSnapshot: item.productNameSnapshot,
              qty: 1,
              notes: item.notes,
              status: "NEW",
            }, req.db);
          }

          try {
            await onOrderItemsConfirmedSent(order.id, [item.id], userId);
          } catch (deductionErr: any) {
            console.error("[inv] deduction error:", deductionErr);
          }

          await storage.updateSalesLedgerItems(item.id, {
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          }, req.db);
        }

        await storage.updateOrder(order.id, { status: "IN_KITCHEN" }, req.db);
        await storage.recalcOrderTotal(order.id, req.db);
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "WAITER_ACCEPTED_QR",
        entityType: "qr_submission",
        entityId: subId,
        tableId: sub.tableId,
        metadata: { itemCount: subItems.length, submissionId: subId },
      });

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId: sub.tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId: sub.tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId: sub.tableId });

      // Return full current view payload for immediate UI refresh
      const updatedOrder = await storage.getOpenOrderForTable(sub.tableId, req.db);
      const updatedItems = updatedOrder ? await storage.getOrderItems(updatedOrder.id, req.db) : [];
      const updatedPendingSubs = updatedOrder ? await storage.getPendingSubmissions(updatedOrder.id, req.db) : [];
      const updatedSubsWithItems = [];
      for (const s of updatedPendingSubs) {
        const sItems = updatedItems.filter(i => i.qrSubmissionId === s.id);
        updatedSubsWithItems.push({ ...s, items: sItems });
      }

      res.json({
        ok: true,
        ticketIds: createdTicketIds,
        table,
        activeOrder: updatedOrder,
        orderItems: updatedItems,
        pendingQrSubmissions: updatedSubsWithItems,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: VOID ORDER ITEM (full or partial) ====================
  app.post("/api/waiter/orders/:orderId/items/:itemId/void", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const itemId = parseInt(req.params.itemId as string);
      const userId = req.session.userId!;
      const user = (req as any).user;
      const { reason, reasonCode, reasonText, qtyToVoid, managerPin } = req.body;

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      if (order.status === "PAID") {
        return res.status(403).json({ message: "No se puede anular ítems de una orden ya pagada" });
      }

      const item = await storage.getOrderItem(itemId, req.db);
      if (!item || item.orderId !== orderId) {
        return res.status(404).json({ message: "Ítem no encontrado en esta orden" });
      }

      if (item.status === "VOIDED") {
        return res.status(400).json({ message: "El ítem ya está anulado" });
      }

      let authorizedManagerId: number | null = null;
      let authorizedManagerName: string | null = null;
      let authorizedBySession = false;

      if (item.sentToKitchenAt) {
        if (reasonCode) {
          if (!(VOID_REASON_CODES as readonly string[]).includes(reasonCode)) {
            return res.status(400).json({ message: "Código de razón inválido" });
          }
          if (reasonCode === "OTHER" && (!reasonText || typeof reasonText !== "string" || reasonText.trim().length < 3)) {
            return res.status(400).json({ message: "Debe especificar una razón de al menos 3 caracteres" });
          }
        } else {
          return res.status(400).json({ message: "Razón de anulación obligatoria para ítems enviados a cocina" });
        }

        const currentUserPerms = await storage.getPermissionKeysForRole(user.role);
        if (currentUserPerms.includes("VOID_AUTHORIZE")) {
          authorizedManagerId = userId;
          authorizedManagerName = user.displayName;
          authorizedBySession = true;
        } else {
          if (!managerPin || typeof managerPin !== "string") {
            return res.status(403).json({ message: "Autorización de gerente requerida para anular ítems enviados a cocina" });
          }

          const ip = req.ip || req.socket.remoteAddress || "unknown";
          const now = Date.now();
          const entry = voidPinAttempts.get(ip);
          if (entry && entry.resetAt > now && entry.count >= VOID_PIN_MAX_ATTEMPTS) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({ message: `Demasiados intentos. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.` });
          }

          const allUsers = await storage.getAllUsersWithPin(req.db);
          const usersWithPin = allUsers.filter(u => u.pin && u.active);

          let matchedUser: any = null;
          for (const u of usersWithPin) {
            if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) continue;
            const match = await storage.verifyPin(managerPin, u.pin!);
            if (match) {
              matchedUser = u;
              break;
            }
          }

          if (!matchedUser) {
            if (entry && entry.resetAt > now) {
              entry.count++;
            } else {
              voidPinAttempts.set(ip, { count: 1, resetAt: now + VOID_PIN_WINDOW_MS });
            }
            await storage.createAuditEvent({
              actorType: "USER",
              actorUserId: userId,
              action: "VOID_AUTH_FAILED",
              entityType: "order_item",
              entityId: itemId,
              tableId: order.tableId,
              metadata: { ip, reason: "PIN incorrecto o no encontrado", orderId },
            });
            return res.status(403).json({ message: "PIN de autorización incorrecto" });
          }

          const perms = await storage.getPermissionKeysForRole(matchedUser.role);
          if (!perms.includes("VOID_AUTHORIZE")) {
            if (entry && entry.resetAt > now) {
              entry.count++;
            } else {
              voidPinAttempts.set(ip, { count: 1, resetAt: now + VOID_PIN_WINDOW_MS });
            }
            await storage.createAuditEvent({
              actorType: "USER",
              actorUserId: userId,
              action: "VOID_AUTH_FAILED",
              entityType: "order_item",
              entityId: itemId,
              tableId: order.tableId,
              metadata: { ip, reason: "Usuario no tiene permiso VOID_AUTHORIZE", matchedUserId: matchedUser.id, orderId },
            });
            return res.status(403).json({ message: "El usuario no tiene permiso para autorizar anulaciones" });
          }

          voidPinAttempts.delete(ip);
          authorizedManagerId = matchedUser.id;
          authorizedManagerName = matchedUser.displayName;
        }
      }

      const effectiveReasonCode = reasonCode || null;
      const effectiveReasonText = reasonCode === "OTHER" ? (reasonText || "").trim() : null;
      const voidReasonString = effectiveReasonCode
        ? (effectiveReasonText ? `${effectiveReasonCode}: ${effectiveReasonText}` : effectiveReasonCode)
        : (reason || null);

      const effectiveQty = (typeof qtyToVoid === "number" && qtyToVoid > 0 && qtyToVoid <= item.qty) ? qtyToVoid : item.qty;
      const isFullVoid = effectiveQty >= item.qty;

      const table = order.tableId ? await storage.getTable(order.tableId, req.db) : null;
      const product = await storage.getProduct(item.productId, req.db);
      const allCategories = await storage.getAllCategories(req.db);
      const category = allCategories.find(c => c.id === product?.categoryId);

      if (isFullVoid) {
        await storage.updateOrderItem(itemId, {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedByUserId: userId,
        }, req.db);
        await storage.updateSalesLedgerItems(itemId, { status: "VOIDED" }, req.db);
      } else {
        const newQty = item.qty - effectiveQty;
        await storage.updateOrderItem(itemId, { qty: newQty }, req.db);
        const newSubtotal = (Number(item.productPriceSnapshot) * newQty).toFixed(2);
        await storage.updateSalesLedgerItems(itemId, { qty: newQty, lineSubtotal: newSubtotal }, req.db);
      }

      await storage.createVoidedItem({
        businessDate: order.businessDate || await getBusinessDate(req.tenantSchema),
        tableId: order.tableId,
        tableNameSnapshot: table?.tableName || null,
        orderId,
        orderItemId: itemId,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        categorySnapshot: category?.name || null,
        qtyVoided: effectiveQty,
        unitPriceSnapshot: item.productPriceSnapshot,
        voidReason: voidReasonString,
        voidedByUserId: userId,
        voidedByRole: user.role,
        status: "VOIDED",
        notes: isFullVoid ? null : `Parcial: ${effectiveQty} de ${item.qty}`,
      }, req.db);

      if (item.sentToKitchenAt) {
        await storage.voidKitchenTicketItemsByOrderItem(itemId, effectiveQty, isFullVoid, req.db);
      }
      if (isFullVoid) {
        await storage.cancelPortionReservation(itemId, req.db);
        try { await onOrderItemsVoided([itemId], userId); } catch (e) { console.error("[inv] reversal error:", e); }
      }

      await storage.recalcOrderTotal(orderId, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "ORDER_ITEM_VOIDED",
        entityType: "order_item",
        entityId: itemId,
        tableId: order.tableId,
        metadata: {
          orderId,
          productName: item.productNameSnapshot,
          qtyVoided: effectiveQty,
          originalQty: item.qty,
          partial: !isFullVoid,
          reasonCode: effectiveReasonCode,
          reasonText: effectiveReasonText,
          reason: voidReasonString,
          authorizedBySession,
          role: user.role,
        },
      });

      if (authorizedManagerId) {
        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: authorizedManagerId,
          action: "ORDER_ITEM_VOID_AUTHORIZED",
          entityType: "order_item",
          entityId: itemId,
          tableId: order.tableId,
          metadata: {
            requestedBy: userId,
            authorizedBy: authorizedManagerId,
            managerName: authorizedManagerName,
            reasonCode: effectiveReasonCode,
            reasonText: effectiveReasonText,
            reason: voidReasonString,
            authorizedBySession,
            productId: item.productId,
            productName: item.productNameSnapshot,
            qty: effectiveQty,
            orderId,
          },
        });
      }

      broadcast("order_updated", { tableId: order.tableId, orderId });
      broadcast("table_status_changed", { tableId: order.tableId });
      if (item.sentToKitchenAt) {
        broadcast("kitchen_item_status_changed", { orderItemId: itemId, status: "VOIDED" });
      }

      const autoCloseResult = await maybeAutoCloseOrder(orderId, broadcast, req.db);

      res.json({ ok: true, autoClosed: autoCloseResult?.closed || false });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== MANAGER: HARD DELETE ORDER ITEM ====================
  app.delete("/api/waiter/orders/:orderId/items/:itemId", requireRole("MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const itemId = parseInt(req.params.itemId as string);
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const item = await storage.getOrderItem(itemId, req.db);
      if (!item || item.orderId !== orderId) {
        return res.status(404).json({ message: "Ítem no encontrado en esta orden" });
      }

      if (item.sentToKitchenAt && item.status !== "VOIDED") {
        return res.status(403).json({ message: "No se permite eliminar items enviados a cocina. Use anulación." });
      }

      if (item.sentToKitchenAt && item.status === "VOIDED") {
        try { await onOrderItemsVoided([itemId], userId); } catch (e) { console.error("[inv] reversal error:", e); }
      }

      await storage.deleteOrderItem(itemId, req.db);

      await storage.recalcOrderTotal(orderId, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "ORDER_ITEM_DELETED_HARD",
        entityType: "order_item",
        entityId: itemId,
        tableId: order.tableId,
        metadata: {
          orderId,
          productName: item.productNameSnapshot,
          qty: item.qty,
          status: item.status,
        },
      });

      broadcast("order_updated", { tableId: order.tableId, orderId });
      broadcast("table_status_changed", { tableId: order.tableId });

      const autoCloseResult = await maybeAutoCloseOrder(orderId, broadcast, req.db);

      res.json({ ok: true, autoClosed: autoCloseResult?.closed || false });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: GET VOIDED ITEMS ====================
  app.get("/api/waiter/orders/:orderId/voided-items", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const items = await storage.getVoidedItemsForOrder(orderId, req.db);
      const userIds = Array.from(new Set(items.map(i => i.voidedByUserId)));
      const usersMap = new Map<number, string>();
      const bulkUsers = await storage.getUsersByIds(userIds, req.db);
      for (const u of bulkUsers) usersMap.set(u.id, u.displayName);
      const result = items.map(i => ({
        ...i,
        voidedAt: i.voidedAt?.toISOString() || null,
        voidedByName: usersMap.get(i.voidedByUserId) || "Desconocido",
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== QR CLIENT ====================
  app.get("/api/qr/:tableCode/info", async (req, res) => {
    const table = await storage.getTableByCode(req.params.tableCode, req.db);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });
    const config = await storage.getBusinessConfig(req.tenantSchema);
    const maxSubaccounts = (config as any)?.maxSubaccounts ?? 15;
    const openOrder = await storage.getOpenOrderForTable(table.id, req.db);
    const hasGuestCount = !!(openOrder && openOrder.guestCount && openOrder.guestCount > 0);
    res.json({ tableName: table.tableName, tableCode: table.tableCode, maxSubaccounts, hasGuestCount, orderId: openOrder?.id || null });
  });

  app.patch("/api/qr/:tableCode/guest-count", async (req, res) => {
    try {
      const table = await storage.getTableByCode(req.params.tableCode, req.db);
      if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });
      const guestCount = parseInt(req.body.guestCount);
      if (isNaN(guestCount) || guestCount < 1) return res.status(400).json({ message: "Cantidad inválida" });
      let order = await storage.getOpenOrderForTable(table.id, req.db);
      if (!order) {
        const businessDate = await getBusinessDate(req.tenantSchema);
        order = await storage.createOrder({
          tableId: table.id,
          status: "OPEN",
          responsibleWaiterId: null,
          businessDate,
        }, req.db);
        try {
          const txCode = await generateTransactionCode(req.db, businessDate);
          order = await storage.updateOrder(order.id, { transactionCode: txCode } as any, req.db);
        } catch (codeErr) {
          console.warn("[txCode] qr guest-count:", codeErr);
        }
      }
      await storage.updateOrder(order.id, { guestCount }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qr/:tableCode/menu", async (req, res) => {
    const isEasyMode = req.query.mode === "easy";
    const [table, prods, cats] = await Promise.all([
      storage.getTableByCode(req.params.tableCode as string, req.db),
      storage.getQRProducts(req.db),
      storage.getAllCategories(req.db),
    ]);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

    const easyCatIds = isEasyMode
      ? new Set(cats.filter(c => c.easyMode && c.active).map(c => c.id))
      : null;

    const catMap = new Map(cats.map(c => [c.id, c]));
    const topCatSortMap = new Map(
      cats.filter(c => c.categoryCode.startsWith("TOP-") && c.active)
        .map(c => [c.categoryCode, c.sortOrder])
    );

    const result = prods
      .filter(p => p.availablePortions === null || p.availablePortions > 0)
      .filter(p => !isEasyMode || (p.easyMode && p.categoryId && easyCatIds!.has(p.categoryId)))
      .map(p => {
        const cat = p.categoryId ? catMap.get(p.categoryId) : null;
        const parentCode = cat?.parentCategoryCode || null;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          categoryName: cat?.name || null,
          categoryFoodType: cat?.foodType || "comidas",
          categoryParentCode: parentCode,
          categorySortOrder: cat?.sortOrder ?? 9999,
          topCategorySortOrder: parentCode ? (topCatSortMap.get(parentCode) ?? 9999) : 9999,
          availablePortions: p.availablePortions,
        };
      })
      .sort((a, b) =>
        a.topCategorySortOrder - b.topCategorySortOrder
        || a.categorySortOrder - b.categorySortOrder
        || a.name.localeCompare(b.name)
      );

    const topCats = cats.filter(c => c.categoryCode.startsWith("TOP-") && c.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => ({ code: c.categoryCode, name: c.name }));

    res.json({ products: result, topCategories: topCats });
  });

  app.get("/api/qr/:tableCode/my-items", async (req, res) => {
    const table = await storage.getTableByCode(req.params.tableCode, req.db);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

    const order = await storage.getOpenOrderForTable(table.id, req.db);
    if (!order) return res.json([]);

    const items = await storage.getOrderItems(order.id, req.db);
    const qrItems = items
      .filter(i => i.origin === "QR" && i.status !== "VOIDED")
      .map(i => ({
        id: i.id,
        productName: i.productNameSnapshot,
        qty: i.qty,
        price: i.productPriceSnapshot,
        status: i.status,
      }));
    res.json(qrItems);
  });

  app.post("/api/qr/:tableCode/submit", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const rateLimitRecord = await storage.getQrRateLimit(tableCode, req.db);
      if (rateLimitRecord && (Date.now() - rateLimitRecord.lastSubmissionAt.getTime()) < 30000) {
        return res.status(429).json({ message: "Espere un momento antes de enviar otro pedido" });
      }

      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      // Get or create order (defensive: prevents duplicates via race condition)
      let order = await getOrCreateOrderForTable(table.id, null, req.tenantSchema, req.db);

      // Get max round number
      const existingItems = await storage.getOrderItems(order.id, req.db);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      // Create QR submission
      const sub = await storage.createQrSubmission({
        orderId: order.id,
        tableId: table.id,
        status: "PENDING",
      }, req.db);

      const allCategories = await storage.getAllCategories(req.db);

      for (const item of items) {
        const product = await storage.getProduct(item.productId, req.db);
        if (!product || !product.active) continue;

        if (product.availablePortions !== null && product.availablePortions < item.qty) {
          return res.status(400).json({ message: `${product.name}: solo ${product.availablePortions} porciones disponibles` });
        }

        const category = allCategories.find(c => c.id === product.categoryId);

        const orderItem = await storage.createOrderItem({
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          productPriceSnapshot: product.price,
          qty: item.qty,
          notes: item.notes || null,
          origin: "QR",
          createdByUserId: null,
          responsibleWaiterId: order.responsibleWaiterId,
          status: "PENDING",
          roundNumber,
          qrSubmissionId: sub.id,
        }, req.db);

        const qrTaxLinks = await storage.getProductTaxCategories(product.id, req.db);
        if (qrTaxLinks.length > 0) {
          const allTaxCats = await storage.getAllTaxCategories(req.db);
          const taxSnapshot = qrTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot }, req.db);
          }
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const mod of item.modifiers) {
            await storage.createOrderItemModifier({
              orderItemId: orderItem.id,
              modifierOptionId: mod.optionId,
              nameSnapshot: mod.name,
              priceDeltaSnapshot: mod.priceDelta || "0",
              qty: mod.qty || 1,
            }, req.db);
          }
        }

        const qrModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const qrUnitWithMods = Number(product.price) + qrModDelta;

        // Sales ledger
        await storage.createSalesLedgerItem({
          businessDate: await getBusinessDate(req.tenantSchema),
          tableId: table.id,
          tableNameSnapshot: table.tableName,
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: product.id,
          productCodeSnapshot: product.productCode,
          productNameSnapshot: product.name,
          categoryId: product.categoryId,
          categoryCodeSnapshot: category?.categoryCode || null,
          categoryNameSnapshot: category?.name || null,
          qty: item.qty,
          unitPrice: qrUnitWithMods.toFixed(2),
          lineSubtotal: (qrUnitWithMods * item.qty).toFixed(2),
          origin: "QR",
          createdByUserId: null,
          responsibleWaiterId: order.responsibleWaiterId,
          status: "OPEN",
        }, req.db);
      }

      await storage.recalcOrderTotal(order.id, req.db);

      // Audit
      await storage.createAuditEvent({
        actorType: "QR",
        actorUserId: null,
        action: "QR_SUBMISSION_CREATED",
        entityType: "qr_submission",
        entityId: sub.id,
        tableId: table.id,
        metadata: { itemCount: items.length },
      });

      broadcast("qr_submission_created", { tableId: table.id, tableName: table.tableName, submissionId: sub.id, itemsCount: items.length });
      broadcast("order_updated", { tableId: table.id, orderId: order.id });

      await storage.upsertQrRateLimit(tableCode, req.db);

      res.json({ ok: true, submissionId: sub.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== KDS ====================
  app.get("/api/kds/tickets/:type", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    const t0 = Date.now();
    const type = req.params.type;
    const destination = (req.query.destination as string) || undefined;
    let tickets;
    if (type === "active") {
      tickets = await storage.getActiveKitchenTickets(destination, req.db);
    } else {
      tickets = await storage.getHistoryKitchenTickets(destination, req.db);
    }

    const ticketIds = tickets.map(t => t.id);
    const allTicketItems = ticketIds.length > 0 ? await storage.getKitchenTicketItemsByTicketIds(ticketIds, req.db) : [];

    const allOrderItemIds = allTicketItems.map(i => i.orderItemId);
    const allMods = allOrderItemIds.length > 0 ? await storage.getOrderItemModifiersByItemIds(allOrderItemIds, req.db) : [];
    const modsByItem = new Map<number, typeof allMods>();
    for (const m of allMods) {
      if (!modsByItem.has(m.orderItemId)) modsByItem.set(m.orderItemId, []);
      modsByItem.get(m.orderItemId)!.push(m);
    }

    const groupCounts = new Map<string, number>();
    for (const i of allTicketItems) {
      if (i.kitchenItemGroupId) {
        groupCounts.set(i.kitchenItemGroupId, (groupCounts.get(i.kitchenItemGroupId) || 0) + 1);
      }
    }

    const result = [];
    for (const t of tickets) {
      const items = allTicketItems.filter(i => i.kitchenTicketId === t.id);
      const nonVoided = items.filter(i => i.status !== "VOIDED");
      if (type === "active" && nonVoided.length === 0) continue;
      const itemsWithMods = nonVoided.map(i => ({
        ...i,
        prepStartedAt: i.prepStartedAt?.toISOString() || null,
        readyAt: i.readyAt?.toISOString() || null,
        modifiers: modsByItem.get(i.orderItemId) || [],
        totalInGroup: i.kitchenItemGroupId ? (groupCounts.get(i.kitchenItemGroupId) || 1) : null,
      }));
      result.push({
        ...t,
        createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
        items: itemsWithMods,
      });
    }
    if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/kds/tickets/${type} ${Date.now() - t0}ms (${tickets.length} tickets, ${allTicketItems.length} items)`);
    res.json(result);
  });

  const ORDER_STATUS_RANK: Record<string, number> = {
    "OPEN": 0,
    "PENDING": 1,
    "IN_KITCHEN": 2,
    "PREPARING": 3,
    "READY": 4,
    "PAID": 5,
    "VOIDED": 6,
    "SPLIT": 7,
  };

  async function recalcOrderStatusFromItems(orderId: number, dbInstance?: typeof db) {
    const items = await storage.getOrderItems(orderId, dbInstance);
    const activeItems = items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
    if (activeItems.length === 0) return;

    const allReady = activeItems.every(i => i.status === "READY");
    const allPreparingOrReady = activeItems.every(i => i.status === "PREPARING" || i.status === "READY");

    const order = await storage.getOrder(orderId, dbInstance);
    if (!order || order.status === "PAID" || order.status === "VOIDED" || order.status === "SPLIT") return;

    let newStatus: string;
    if (allReady) {
      newStatus = "READY";
    } else if (allPreparingOrReady) {
      newStatus = "PREPARING";
    } else {
      newStatus = "IN_KITCHEN";
    }

    const currentRank = ORDER_STATUS_RANK[order.status] ?? 0;
    const newRank = ORDER_STATUS_RANK[newStatus] ?? 0;
    if (newRank <= currentRank && order.status !== "OPEN") return;

    await storage.updateOrder(orderId, { status: newStatus }, dbInstance);
    broadcast("order_updated", { orderId });
    broadcast("table_status_changed", {});
  }

  app.patch("/api/kds/items/:id", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    try {
      const itemId = parseInt(req.params.id as string);
      const { status } = req.body;
      const data: any = { status };
      if (status === "PREPARING") data.prepStartedAt = new Date();
      if (status === "READY") data.readyAt = new Date();

      const item = await storage.updateKitchenTicketItem(itemId, data, req.db);

      if (item) {
        if (item.kitchenItemGroupId) {
          const groupItems = await storage.getKitchenTicketItemsByGroupId(item.kitchenItemGroupId, req.db);
          const allGroupReady = groupItems.every(gi => gi.status === "READY");
          const anyPreparing = groupItems.some(gi => gi.status === "PREPARING");
          if (allGroupReady) {
            await storage.updateOrderItem(item.orderItemId, { status: "READY" }, req.db);
            await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() }, req.db);
          } else if (anyPreparing || status === "PREPARING") {
            await storage.updateOrderItem(item.orderItemId, { status: "PREPARING" }, req.db);
          }
        } else {
          const orderItemStatus = status === "PREPARING" ? "PREPARING" : status === "READY" ? "READY" : item.status;
          await storage.updateOrderItem(item.orderItemId, { status: orderItemStatus }, req.db);
          if (status === "READY") {
            await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() }, req.db);
          }
        }

        const ticket = await storage.getKitchenTicketByItemId(item.id, req.db);
        if (ticket) {
          await recalcOrderStatusFromItems(ticket.orderId, req.db);
        }
      }

      broadcast("kitchen_item_status_changed", { itemId, status });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/kds/tickets/:id", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id as string);
      const { status } = req.body;
      const ticket = await storage.updateKitchenTicket(ticketId, { status }, req.db);

      const items = await storage.getKitchenTicketItems(ticketId, req.db);
      for (const item of items) {
        if (item.status !== "READY") {
          await storage.updateKitchenTicketItem(item.id, { status: "READY", readyAt: new Date() }, req.db);
          await storage.updateOrderItem(item.orderItemId, { status: "READY" }, req.db);
          await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() }, req.db);
        }
      }

      if (ticket) {
        await recalcOrderStatusFromItems(ticket.orderId, req.db);

        try {
          const [ord] = await req.db.select().from(orders).where(eq(orders.id, ticket.orderId));
          if (ord) {
            const ordItems = await req.db.select().from(orderItems).where(eq(orderItems.orderId, ord.id));
            notifyDispatchReady(ord.id, {
              orderId: ord.id,
              customerName: ordItems[0]?.customerNameSnapshot || "Cliente",
              tableCode: ticket.tableNameSnapshot || "",
              items: ordItems.map((i: any) => ({ name: i.productNameSnapshot, qty: i.qty })),
              readyAt: new Date().toISOString(),
            });
          }
        } catch (dispatchErr: any) {
          console.error("[dispatch-notify]", dispatchErr.message);
        }
      }

      broadcast("kitchen_item_status_changed", { ticketId, status: "READY" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/kds/clear-history", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    const destination = (req.query.destination as string) || undefined;
    await storage.clearKitchenHistory(destination, req.db);
    res.json({ ok: true });
  });

  // ==================== POS: PAYMENT METHODS (for cashier access) ====================
  app.get("/api/pos/payment-methods", requirePermission("POS_VIEW"), async (req, res) => {
    res.json(await storage.getAllPaymentMethods(req.db));
  });

  app.get("/api/pos/employees-for-charge", requirePermission("EMPLOYEE_CHARGE"), async (req, res) => {
    try {
      const employees = await req.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.active, true))
        .orderBy(asc(users.displayName));
      res.json(employees);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function finalizePaymentTx(tx: any, opts: { orderId: number; itemIds?: number[]; now: Date; closeOrder?: boolean }) {
    const { orderId, itemIds, now, closeOrder } = opts;
    const itemCondition = itemIds
      ? and(inArray(orderItems.id, itemIds), sql`${orderItems.status} NOT IN ('VOIDED','PAID')`)
      : and(eq(orderItems.orderId, orderId), sql`${orderItems.status} NOT IN ('VOIDED','PAID')`);
    await tx.update(orderItems).set({ status: "PAID" }).where(itemCondition);

    const sliCondition = itemIds
      ? and(inArray(salesLedgerItems.orderItemId, itemIds), sql`${salesLedgerItems.status} NOT IN ('VOIDED','PAID')`)
      : and(eq(salesLedgerItems.orderId, orderId), sql`${salesLedgerItems.status} NOT IN ('VOIDED','PAID')`);
    await tx.update(salesLedgerItems).set({ status: "PAID", paidAt: now }).where(sliCondition);

    if (closeOrder) {
      await tx.update(orders).set({ status: "PAID", closedAt: now }).where(and(eq(orders.id, orderId), ne(orders.status, "PAID")));
    }

    const splits = await tx.select({ id: splitAccounts.id }).from(splitAccounts).where(eq(splitAccounts.orderId, orderId));
    if (splits.length > 0) {
      const splitIds = splits.map((s: any) => s.id);
      await tx.delete(splitItems).where(inArray(splitItems.splitId, splitIds));
      await tx.delete(splitAccounts).where(eq(splitAccounts.orderId, orderId));
    }

    await tx.delete(orderSubaccounts).where(eq(orderSubaccounts.orderId, orderId));
  }

  async function maybeAutoCloseParentOrder(orderId: number, dbInstance?: typeof db) {
    const paidOrder = await storage.getOrder(orderId, dbInstance);
    if (!paidOrder?.parentOrderId) return;
    const siblings = await storage.getChildOrders(paidOrder.parentOrderId, dbInstance);
    const allSiblingsPaid = siblings.every(s => s.status === "PAID" || s.status === "VOIDED");
    if (!allSiblingsPaid) return;
    const parentOrder = await storage.getOrder(paidOrder.parentOrderId, dbInstance);
    if (!parentOrder || (parentOrder.status !== "SPLIT" && parentOrder.status !== "OPEN")) return;
    const parentItems = await storage.getOrderItems(paidOrder.parentOrderId, dbInstance);
    const parentActive = parentItems.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
    if (parentActive.length === 0) {
      await storage.updateOrder(paidOrder.parentOrderId, { status: "PAID", closedAt: new Date() }, dbInstance);
      await cleanupSubaccountsForOrder(paidOrder.parentOrderId, dbInstance || db);
    }
  }

  async function buildServiceChargeOps(orderId: number, order: any, activeItems: any[], schema?: string, dbInstance?: typeof db) {
    try {
      const [bizConfig, allProducts, existing] = await Promise.all([
        storage.getBusinessConfig(schema),
        storage.getAllProducts(dbInstance),
        storage.getServiceChargeByOrder(orderId, dbInstance),
      ]);
      let scRate = 0.10;
      if (bizConfig?.serviceTaxCategoryId) {
        const taxCat = await storage.getTaxCategory(bizConfig.serviceTaxCategoryId, dbInstance);
        if (taxCat && taxCat.active) {
          scRate = Number(taxCat.rate) / 100;
        }
      }
      if (scRate <= 0) return;
      const paidItemIds = new Set(
        existing.filter(x => x.status === "PAID").map(x => x.orderItemId)
      );
      const productMap = new Map(allProducts.map(p => [p.id, p]));
      const tableName = order.tableId ? (await storage.getTable(order.tableId, dbInstance))?.tableName : null;
      const bd = await getBusinessDate(schema);
      const entries: any[] = [];
      for (const item of activeItems) {
        const itemKey = item.id;
        if (paidItemIds.has(itemKey)) continue;
        const prod = item.productId ? productMap.get(item.productId) : null;
        if (!prod) {
          try {
            await storage.createAuditEvent({
              actorType: "SYSTEM",
              actorUserId: order.responsibleWaiterId || null,
              action: "SERVICE_LEDGER_SKIPPED_PRODUCT_NOT_FOUND",
              metadata: JSON.stringify({ orderId, orderItemId: itemKey, productId: item.productId }),
            });
          } catch (_) {}
          continue;
        }
        if (!prod.serviceTaxApplicable) continue;
        const gross = Number(item.productPriceSnapshot) * item.qty;
        const serviceAmount = Math.round(gross * scRate / (1 + scRate) * 100) / 100;
        if (serviceAmount > 0) {
          entries.push({
            businessDate: bd,
            orderId,
            orderItemId: itemKey,
            tableId: order.tableId || null,
            tableNameSnapshot: tableName || null,
            responsibleWaiterEmployeeId: order.responsibleWaiterId || null,
            rateSnapshot: scRate.toFixed(4),
            baseAmountSnapshot: gross.toFixed(2),
            serviceAmount: serviceAmount.toFixed(2),
            includesServiceSnapshot: true,
            status: "PAID",
          });
        }
      }
      if (entries.length > 0) {
        await Promise.all(entries.map(e => storage.createServiceChargeLedgerEntry(e, dbInstance)));
      }
    } catch (scErr) {
      console.error("[ServiceCharge] Error creating ledger entries:", scErr);
    }
  }

  async function createDispatchKitchenTickets(orderId: number, order: any, dbInstance: typeof db, now: Date) {
    const allItems = await storage.getOrderItems(orderId, dbInstance);
    const pendingItems = allItems.filter(i => i.status !== "VOIDED");
    if (pendingItems.length === 0) return;

    const uniqueProductIds = Array.from(new Set(pendingItems.map(i => i.productId)));
    const [productsArr, allCategories] = await Promise.all([
      uniqueProductIds.length > 0
        ? dbInstance.select().from(products).where(inArray(products.id, uniqueProductIds))
        : Promise.resolve([]),
      storage.getAllCategories(dbInstance),
    ]);

    const productsMap = new Map(productsArr.map((p: any) => [p.id, p]));
    const tableNameLabel = order.transactionCode ? `Despacho #${order.transactionCode}` : `Despacho #${order.dailyNumber || orderId}`;

    const kdsTickets: Map<string, number> = new Map();
    const createdTicketIds: number[] = [];

    for (const item of pendingItems) {
      const product = productsMap.get(item.productId);
      const category = allCategories.find((c: any) => c.id === (product as any)?.categoryId);
      const kdsDestination = (category as any)?.kdsDestination || "cocina";

      if (!kdsTickets.has(kdsDestination)) {
        const ticket = await storage.createKitchenTicket({
          orderId,
          tableId: order.tableId || null,
          tableNameSnapshot: tableNameLabel,
          status: "NEW",
          kdsDestination,
        }, dbInstance);
        kdsTickets.set(kdsDestination, ticket.id);
        createdTicketIds.push(ticket.id);
      }

      const ticketId = kdsTickets.get(kdsDestination)!;

      await storage.updateOrderItem(item.id, { status: "SENT", sentToKitchenAt: now }, dbInstance);

      if (item.qty > 1) {
        const groupId = crypto.randomUUID();
        for (let seq = 1; seq <= item.qty; seq++) {
          await storage.createKitchenTicketItem({
            kitchenTicketId: ticketId,
            orderItemId: item.id,
            productNameSnapshot: item.productNameSnapshot,
            qty: 1,
            notes: item.notes,
            status: "NEW",
            kitchenItemGroupId: groupId,
            seqInGroup: seq,
          }, dbInstance);
        }
      } else {
        await storage.createKitchenTicketItem({
          kitchenTicketId: ticketId,
          orderItemId: item.id,
          productNameSnapshot: item.productNameSnapshot,
          qty: 1,
          notes: item.notes,
          status: "NEW",
        }, dbInstance);
      }
    }

    await dbInstance.update(orders).set({ dispatchStatus: "PAID" }).where(eq(orders.id, orderId));

    if (createdTicketIds.length > 0) {
      broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId: order.tableId });
    }
  }

  // ==================== POS ====================
  app.get("/api/pos/tables", requirePermission("POS_VIEW"), async (req, res) => {
    const t0 = Date.now();
    const [allTables, allOpenOrders] = await Promise.all([
      storage.getAllTables(false, req.db),
      storage.getAllOpenOrders(req.db),
    ]);
    const tableMap = new Map(allTables.map(t => [t.id, t]));
    const tableOrders = allOpenOrders.filter(o => o.tableId && tableMap.has(o.tableId));
    const quickSaleOrders = allOpenOrders.filter(o => (o as any).isQuickSale && !o.tableId);
    const relevantOrders = [...tableOrders, ...quickSaleOrders];
    if (relevantOrders.length === 0) return res.json([]);

    const orderIds = relevantOrders.map(o => o.id);
    const parentOrderIds = relevantOrders.filter(o => o.parentOrderId).map(o => o.parentOrderId!);
    const allSubaccountQueryIds = Array.from(new Set([...orderIds, ...parentOrderIds]));

    const [itemCounts, allSubaccounts] = await Promise.all([
      storage.getActiveItemCountsByOrderIds(orderIds, req.db),
      allSubaccountQueryIds.length > 0
        ? req.db.select().from(orderSubaccounts).where(inArray(orderSubaccounts.orderId, allSubaccountQueryIds))
        : Promise.resolve([]),
    ]);

    const subaccountsByOrder = new Map<number, string[]>();
    for (const sa of allSubaccounts) {
      if (sa.label) {
        if (!subaccountsByOrder.has(sa.orderId)) subaccountsByOrder.set(sa.orderId, []);
        subaccountsByOrder.get(sa.orderId)!.push(sa.label);
      }
    }

    if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/tables ${Date.now() - t0}ms (${relevantOrders.length} orders)`);

    const dispatchOrders = await req.db.select().from(orders)
      .where(and(
        sql`${orders.status} = 'OPEN'`,
        sql`${(orders as any).orderMode} = 'DISPATCH'`,
        sql`${(orders as any).dispatchStatus} = 'PENDING_PAYMENT'`
      ));
    const dispatchOrderIds = dispatchOrders.map(o => o.id);
    const dispatchItemCountRows = dispatchOrderIds.length > 0
      ? await req.db.select({ orderId: orderItems.orderId, cnt: count() })
          .from(orderItems)
          .where(and(inArray(orderItems.orderId, dispatchOrderIds), sql`${orderItems.status} NOT IN ('VOIDED','PAID')`))
          .groupBy(orderItems.orderId)
      : [];
    const dispatchItemCounts = new Map(dispatchItemCountRows.map(r => [r.orderId, Number(r.cnt)]));

    const result: any[] = [];
    for (const order of relevantOrders) {
      const activeCount = itemCounts.get(order.id) || 0;
      if (activeCount === 0) continue;

      const isQuickSale = !!(order as any).isQuickSale && !order.tableId;
      const isChild = !!order.parentOrderId;
      const ticketNumber = isChild
        ? `${order.dailyNumber}-${order.splitIndex}`
        : `${order.dailyNumber}`;

      let displayName: string;
      let tableId: number;
      if (isQuickSale) {
        const qsName = (order as any).quickSaleName || "Venta Rápida";
        displayName = `${qsName} #${order.dailyNumber}`;
        tableId = 0;
      } else {
        const table = tableMap.get(order.tableId!)!;
        displayName = isChild
          ? `${table.tableName} #${ticketNumber}`
          : `${table.tableName} #${order.dailyNumber}`;
        tableId = table.id;
      }

      const names = new Set<string>();
      const saNames = subaccountsByOrder.get(order.id) || [];
      saNames.forEach(n => names.add(n));
      if (order.parentOrderId) {
        const parentSaNames = subaccountsByOrder.get(order.parentOrderId) || [];
        parentSaNames.forEach(n => names.add(n));
      }

      result.push({
        id: tableId,
        tableName: displayName,
        orderId: order.id,
        parentOrderId: order.parentOrderId || null,
        splitIndex: order.splitIndex || null,
        dailyNumber: order.dailyNumber,
        globalNumber: order.globalNumber,
        ticketNumber,
        totalAmount: order.totalAmount,
        balanceDue: order.balanceDue,
        paidAmount: order.paidAmount,
        openedAt: order.openedAt,
        itemCount: activeCount,
        subaccountNames: Array.from(names),
        isQuickSale,
        transactionCode: (order as any).transactionCode || null,
      });
    }

    for (const dOrder of dispatchOrders) {
      const dCount = dispatchItemCounts.get(dOrder.id) || 0;
      if (dCount === 0) continue;
      const dTable = dOrder.tableId ? tableMap.get(dOrder.tableId) : null;
      const dDisplayName = dTable
        ? `${dTable.tableName} #${dOrder.dailyNumber} [Despacho]`
        : `Despacho #${(dOrder as any).transactionCode || dOrder.dailyNumber}`;
      result.push({
        id: dTable?.id ?? 0,
        tableName: dDisplayName,
        orderId: dOrder.id,
        parentOrderId: null,
        splitIndex: null,
        dailyNumber: dOrder.dailyNumber,
        globalNumber: dOrder.globalNumber,
        ticketNumber: `${dOrder.dailyNumber}`,
        totalAmount: dOrder.totalAmount,
        balanceDue: dOrder.balanceDue,
        paidAmount: dOrder.paidAmount,
        openedAt: dOrder.openedAt,
        itemCount: dCount,
        subaccountNames: [],
        isQuickSale: false,
        isDispatch: true,
        dispatchStatus: (dOrder as any).dispatchStatus,
        transactionCode: (dOrder as any).transactionCode || null,
      });
    }

    res.json(result);
  });

  app.get("/api/pos/table-detail/:orderId", requirePermission("POS_VIEW"), async (req, res) => {
    const t0 = Date.now();
    const orderId = parseInt(req.params.orderId as string);
    const order = await storage.getOrder(orderId, req.db);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    const isQuickSale = !!(order as any).isQuickSale && !order.tableId;
    let table: any = null;
    if (!isQuickSale) {
      table = await storage.getTable(order.tableId!, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
    }

    const [allItems, allMods, allItemDiscounts, allItemTaxes, allSubaccounts] = await Promise.all([
      storage.getOrderItems(orderId, req.db),
      storage.getOrderItemModifiersByOrderIds([orderId], req.db),
      storage.getOrderItemDiscountsByOrderIds([orderId], req.db),
      storage.getOrderItemTaxesByOrderIds([orderId], req.db),
      req.db.select().from(orderSubaccounts).where(
        inArray(orderSubaccounts.orderId, order.parentOrderId ? [orderId, order.parentOrderId] : [orderId])
      ),
    ]);

    const isDispatch = (order as any).orderMode === "DISPATCH";
    const activeItems = allItems.filter(i => {
      if (i.status === "VOIDED" || i.status === "PAID") return false;
      if (i.status === "PENDING" && !isDispatch) return false;
      return true;
    });
    const activeItemIds = new Set(activeItems.map(i => i.id));

    const modsMap = new Map<number, typeof allMods>();
    for (const m of allMods) { if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []); modsMap.get(m.orderItemId)!.push(m); }
    const discountsMap = new Map<number, typeof allItemDiscounts>();
    for (const d of allItemDiscounts) { if (!discountsMap.has(d.orderItemId)) discountsMap.set(d.orderItemId, []); discountsMap.get(d.orderItemId)!.push(d); }
    const taxesMap = new Map<number, typeof allItemTaxes>();
    for (const t of allItemTaxes) { if (!taxesMap.has(t.orderItemId)) taxesMap.set(t.orderItemId, []); taxesMap.get(t.orderItemId)!.push(t); }

    const itemsWithModifiers = activeItems.map(item => ({
      ...item,
      modifiers: modsMap.get(item.id) || [],
      discounts: discountsMap.get(item.id) || [],
      taxes: taxesMap.get(item.id) || [],
    }));

    const orderDiscountsList = allItemDiscounts.filter(d => activeItemIds.has(d.orderItemId));
    const orderTaxesList = allItemTaxes.filter(t => activeItemIds.has(t.orderItemId));

    const isChild = !!order.parentOrderId;
    const ticketNumber = isChild ? `${order.dailyNumber}-${order.splitIndex}` : `${order.dailyNumber}`;
    let displayName: string;
    if (isQuickSale) {
      const qsName = (order as any).quickSaleName || "Venta Rápida";
      displayName = `${qsName} #${order.dailyNumber}`;
    } else {
      displayName = isChild ? `${table.tableName} #${ticketNumber}` : `${table.tableName} #${order.dailyNumber}`;
    }

    const names = new Set<string>();
    for (const sa of allSubaccounts) { if (sa.label) names.add(sa.label); }
    for (const item of activeItems) { if (item.customerNameSnapshot) names.add(item.customerNameSnapshot); }

    if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/table-detail/${orderId} ${Date.now() - t0}ms`);

    res.json({
      id: table?.id ?? 0,
      tableName: displayName,
      orderId: order.id,
      parentOrderId: order.parentOrderId || null,
      splitIndex: order.splitIndex || null,
      dailyNumber: order.dailyNumber,
      globalNumber: order.globalNumber,
      ticketNumber,
      totalAmount: order.totalAmount,
      balanceDue: order.balanceDue,
      paidAmount: order.paidAmount,
      openedAt: order.openedAt,
      itemCount: activeItems.length,
      items: itemsWithModifiers,
      totalDiscounts: orderDiscountsList.reduce((s, d) => s + Number(d.amountApplied), 0).toFixed(2),
      totalTaxes: orderTaxesList.reduce((s, t) => s + Number(t.taxAmount), 0).toFixed(2),
      taxBreakdown: aggregateTaxBreakdown(orderTaxesList),
      subaccountNames: Array.from(names),
    });
  });

  // ==================== POS: PAY ====================
  app.post("/api/pos/pay", requirePermission("POS_PAY"), async (req, res) => {
    const t0 = Date.now();
    try {
      const { orderId, paymentMethodId, amount, clientName, clientEmail, employeeId } = req.body;
      const userId = req.session.userId!;

      const [order, allPMs, cashSession] = await Promise.all([
        storage.getOrder(orderId, req.db),
        storage.getAllPaymentMethods(req.db),
        storage.getActiveCashSession(req.db),
      ]);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status === "PAID") return res.json({ ok: true, alreadyPaid: true });

      const payAmount = Number(amount);
      const currentBalanceDue = Number(order.balanceDue || order.totalAmount || 0);
      if (payAmount > currentBalanceDue + 0.01) {
        return res.status(400).json({ message: `Monto excede el saldo pendiente (₡${currentBalanceDue.toFixed(2)})` });
      }

      const pm = allPMs.find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH" && !cashSession) {
        return res.status(400).json({ message: "No hay caja abierta. Abra una sesión de caja antes de cobrar en efectivo." });
      }

      const bd = await getBusinessDate(req.tenantSchema);
      const now = new Date();

      const payment = await storage.createPayment({
        orderId,
        splitId: null,
        amount: payAmount.toFixed(2),
        paymentMethodId,
        cashierUserId: userId,
        status: "PAID",
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: bd,
      }, req.db);

      const { balanceDue } = await storage.updateOrderPaymentTotals(orderId, req.db);

      if (balanceDue <= 0) {
        const items = await storage.getOrderItems(orderId, req.db);
        const activeItems = items.filter(i => i.status !== "VOIDED");
        await req.db.transaction(async (tx) => {
          await finalizePaymentTx(tx, { orderId, now, closeOrder: true });
        });
        await buildServiceChargeOps(orderId, order, activeItems, req.tenantSchema, req.db);
        if ((order as any).orderMode === "DISPATCH" && (order as any).dispatchStatus === "PENDING_PAYMENT") {
          try {
            await createDispatchKitchenTickets(orderId, order, req.db, now);
            broadcast("dispatch_order_paid", { orderId, transactionCode: (order as any).transactionCode });
          } catch (dispatchErr: any) {
            console.error("[Dispatch] Kitchen ticket creation error:", dispatchErr.message);
          }
        }
      }

      if (pm?.paymentCode === "CASH" && cashSession) {
        const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) + payAmount;
        await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) }, req.db);
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "PAYMENT_CREATED",
        entityType: "payment",
        entityId: payment.id,
        tableId: order.tableId,
        metadata: { orderId, amount: payAmount, paymentMethodId },
      });

      if (balanceDue <= 0) {
        await maybeAutoCloseParentOrder(orderId, req.db);
      }

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      qbo.enqueueSyncForPayment(payment.id, orderId, req.db).catch(() => {});

      if (pm?.paymentCode === "EMPLOYEE_CHARGE" && employeeId) {
        const orderItemRows = await storage.getOrderItems(orderId, req.db);
        const description = orderItemRows
          .filter(i => i.status !== "VOIDED")
          .map(i => `${i.qty}x ${i.productNameSnapshot}`)
          .join(", ");
        await req.db.insert(employeeCharges).values({
          employeeId: Number(employeeId),
          orderId,
          paymentId: payment.id,
          amount: String(payAmount.toFixed(2)),
          description: `Orden #${order.dailyNumber ?? orderId} — ${description}`,
          businessDate: bd,
          isSettled: false,
          createdBy: userId,
        });
      }

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/pay ${Date.now() - t0}ms`);
      res.json({ ok: true, paymentId: payment.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PAY MULTI (varios métodos) ====================
  app.post("/api/pos/pay-multi", requirePermission("POS_PAY"), async (req, res) => {
    const t0 = Date.now();
    try {
      const { orderId, payments: legs, clientName, clientEmail } = req.body;
      if (!orderId || !Array.isArray(legs) || legs.length < 2) {
        return res.status(400).json({ message: "Se requieren al menos 2 tramos de pago" });
      }
      const userId = req.session.userId!;

      const [order, allPMs, cashSession] = await Promise.all([
        storage.getOrder(orderId, req.db),
        storage.getAllPaymentMethods(req.db),
        storage.getActiveCashSession(req.db),
      ]);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status === "PAID") return res.json({ ok: true, alreadyPaid: true, paymentIds: [], hasCash: false });

      const totalDue = Number(order.balanceDue || order.totalAmount || 0);
      const legsTotal = legs.reduce((s: number, l: any) => s + Number(l.amount), 0);
      if (Math.abs(legsTotal - totalDue) > 1) {
        return res.status(400).json({ message: `La suma de tramos (₡${legsTotal}) no coincide con el saldo (₡${totalDue})` });
      }

      const pmMap = new Map(allPMs.map(p => [p.id, p]));
      const hasCashLeg = legs.some((l: any) => pmMap.get(l.paymentMethodId)?.paymentCode === "CASH");

      for (const leg of legs) {
        const pm = pmMap.get(leg.paymentMethodId);
        if (!pm) return res.status(400).json({ message: `Método de pago ${leg.paymentMethodId} no encontrado` });
      }
      if (hasCashLeg && !cashSession) {
        return res.status(400).json({ message: "No hay caja abierta. Abra una sesión de caja antes de cobrar en efectivo." });
      }

      const bd = await getBusinessDate(req.tenantSchema);
      const now = new Date();

      const paymentValues = legs.map((leg: any) => ({
        orderId,
        splitId: null,
        amount: Number(leg.amount).toFixed(2),
        paymentMethodId: leg.paymentMethodId,
        cashierUserId: userId,
        status: "PAID" as const,
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: bd,
      }));

      const createdPayments = await req.db.insert(payments).values(paymentValues).returning();
      const paymentIds = createdPayments.map(p => p.id);

      const auditValues = createdPayments.map(p => ({
        actorType: "USER" as const,
        actorUserId: userId,
        action: "PAYMENT_CREATED",
        entityType: "payment",
        entityId: p.id,
        tableId: order.tableId,
        metadata: { orderId, amount: Number(p.amount), paymentMethodId: p.paymentMethodId, multiPay: true },
      }));
      await req.db.insert(auditEvents).values(auditValues);

      const { balanceDue } = await storage.updateOrderPaymentTotals(orderId, req.db);

      if (balanceDue <= 0) {
        const items = await storage.getOrderItems(orderId, req.db);
        const activeItems = items.filter(i => i.status !== "VOIDED");
        await req.db.transaction(async (tx) => {
          await finalizePaymentTx(tx, { orderId, now, closeOrder: true });
        });
        await buildServiceChargeOps(orderId, order, activeItems, req.tenantSchema, req.db);
        await maybeAutoCloseParentOrder(orderId, req.db);
        if ((order as any).orderMode === "DISPATCH" && (order as any).dispatchStatus === "PENDING_PAYMENT") {
          try {
            await createDispatchKitchenTickets(orderId, order, req.db, now);
            broadcast("dispatch_order_paid", { orderId, transactionCode: (order as any).transactionCode });
          } catch (dispatchErr: any) {
            console.error("[Dispatch] Kitchen ticket creation error (multi-pay):", dispatchErr.message);
          }
        }
      }

      if (hasCashLeg && cashSession) {
        const cashTotal = legs.reduce((s: number, l: any) => {
          const pm = pmMap.get(l.paymentMethodId);
          return pm?.paymentCode === "CASH" ? s + Number(l.amount) : s;
        }, 0);
        const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) + cashTotal;
        await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) }, req.db);
      }

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      const hasCash = legs.some((l: any) => {
        const pm = pmMap.get(l.paymentMethodId);
        return pm && (pm.paymentCode.toUpperCase().includes("CASH") || pm.paymentCode.toUpperCase().includes("EFECT"));
      });

      for (const pid of paymentIds) {
        qbo.enqueueSyncForPayment(pid, orderId, req.db).catch(() => {});
      }

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/pay-multi ${Date.now() - t0}ms (${legs.length} legs)`);
      res.json({ ok: true, paymentIds, hasCash });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== CASH SESSION ====================
  app.get("/api/pos/cash-session", requirePermission("POS_VIEW"), async (req, res) => {
    const session = await storage.getLatestCashSession(req.db);
    if (!session) return res.json({});

    const user = (req as any).user;
    const userPerms = await storage.getPermissionKeysForRole(user.role);
    const canViewReport = userPerms.includes("POS_VIEW_CASH_REPORT");

    if (!session.closedAt) {
      const totalsByMethod = canViewReport ? await storage.getPaymentsByDateGrouped(await getBusinessDate(req.tenantSchema), req.db) : undefined;
      const result: any = { id: session.id, openingCash: session.openingCash, closedAt: session.closedAt, openedByUserId: session.openedByUserId };
      if (canViewReport) {
        result.expectedCash = session.expectedCash;
        result.totalsByMethod = totalsByMethod;
      }
      return res.json(result);
    }

    if (!canViewReport) {
      return res.json({
        id: session.id,
        openingCash: session.openingCash,
        closedAt: session.closedAt,
        countedCash: session.countedCash,
        openedByUserId: session.openedByUserId,
        closedByUserId: session.closedByUserId,
      });
    }
    res.json(session);
  });

  app.post("/api/pos/cash-session/open", requirePermission("POS_VIEW"), async (req, res) => {
    try {
      const existing = await storage.getActiveCashSession(req.db);
      if (existing) return res.status(400).json({ message: "Ya hay una caja abierta" });

      const session = await storage.createCashSession({
        openedByUserId: req.session.userId!,
        openingCash: req.body.openingCash || "0",
      }, req.db);

      await storage.updateCashSession(session.id, { expectedCash: req.body.openingCash || "0" }, req.db);

      res.json(session);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/cash-session/close", requirePermission("CASH_CLOSE"), async (req, res) => {
    try {
      const session = await storage.getActiveCashSession(req.db);
      if (!session) return res.status(400).json({ message: "No hay caja abierta" });

      const countedCash = parseFloat(req.body.countedCash || "0");
      const expected = parseFloat(session.expectedCash?.toString() || session.openingCash);
      const difference = countedCash - expected;

      const totalsByMethod = await storage.getPaymentsByDateGrouped(await getBusinessDate(req.tenantSchema), req.db);

      const updated = await storage.updateCashSession(session.id, {
        closedAt: new Date(),
        closedByUserId: req.session.userId!,
        countedCash: countedCash.toFixed(2),
        difference: difference.toFixed(2),
        totalsByMethod,
        notes: req.body.notes || null,
      }, req.db);

      res.json({ ...updated, totalsByMethod });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ORDER PAYMENTS ====================
  app.get("/api/pos/orders/:orderId/payments", requirePermission("POS_VIEW"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const orderPayments = await storage.getPaymentsForOrder(orderId, req.db);
      const allMethods = await storage.getAllPaymentMethods(req.db);
      const methodMap = new Map(allMethods.map(m => [m.id, m.paymentName]));
      const result = orderPayments.map(p => ({
        ...p,
        paymentMethodName: methodMap.get(p.paymentMethodId) || "Otro",
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: CANCEL DISPATCH ====================
  app.post("/api/pos/orders/:orderId/cancel-dispatch", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if ((order as any).orderMode !== "DISPATCH") return res.status(400).json({ message: "No es una orden de despacho" });
      if ((order as any).dispatchStatus !== "PENDING_PAYMENT") return res.status(400).json({ message: "La orden ya fue pagada o cancelada" });

      const allItems = await storage.getOrderItems(orderId, req.db);
      const pendingItems = allItems.filter(i => i.status === "PENDING");
      for (const item of pendingItems) {
        await storage.updateOrderItem(item.id, { status: "VOIDED" }, req.db);
      }
      await req.db.update(orders).set({ dispatchStatus: "CANCELLED", status: "CANCELLED" } as any).where(eq(orders.id, orderId));
      await storage.recalcOrderTotal(orderId, req.db);

      broadcast("dispatch_order_cancelled", { orderId, transactionCode: (order as any).transactionCode });
      broadcast("table_status_changed", { tableId: order.tableId });
      broadcast("order_updated", { orderId });

      res.json({ success: true, message: "Orden de despacho cancelada" });
    } catch (err: any) {
      console.error("[cancel-dispatch]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: NORMALIZE FOR SPLIT ====================
  app.post("/api/pos/orders/:orderId/normalize-split", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const result = await storage.normalizeOrderItemsForSplit(orderId, req.db);
      if (result.normalized) {
        await storage.recalcOrderTotal(orderId, req.db);
        broadcast("order_updated", { orderId });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: SPLIT ACCOUNTS ====================
  app.get("/api/pos/orders/:orderId/splits", requirePermission("POS_VIEW"), async (req, res) => {
    try {
      const t0 = Date.now();
      const orderId = parseInt(req.params.orderId as string);
      const splits = await storage.getSplitAccountsForOrder(orderId, req.db);
      if (splits.length === 0) {
        if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/orders/${orderId}/splits ${Date.now() - t0}ms (empty)`);
        return res.json([]);
      }
      const splitIds = splits.map(s => s.id);
      const allSplitItems = await storage.getSplitItemsByAccountIds(splitIds, req.db);
      const itemsBySplit = new Map<number, typeof allSplitItems>();
      for (const si of allSplitItems) {
        if (!itemsBySplit.has(si.splitId)) itemsBySplit.set(si.splitId, []);
        itemsBySplit.get(si.splitId)!.push(si);
      }
      const result = splits.map(s => ({ ...s, items: itemsBySplit.get(s.id) || [] }));
      if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/orders/${orderId}/splits ${Date.now() - t0}ms`);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/orders/:orderId/splits", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const { label, orderItemIds } = req.body;
      if (!label) {
        return res.status(400).json({ message: "Label es requerido" });
      }

      const split = await storage.createSplitAccount({ orderId, label }, req.db);

      if (orderItemIds && Array.isArray(orderItemIds)) {
        for (const orderItemId of orderItemIds) {
          await storage.createSplitItem({ splitId: split.id, orderItemId }, req.db);
        }
      }

      const items = await storage.getSplitItemsForSplit(split.id, req.db);
      broadcast("order_updated", { orderId });
      res.json({ ...split, items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/pos/splits/:id", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteSplitAccount(id, req.db);
      broadcast("order_updated", {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/split-items/move", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const { orderItemId, fromSplitId, toSplitId } = req.body;
      if (!orderItemId) return res.status(400).json({ message: "orderItemId requerido" });

      if (fromSplitId) {
        await storage.removeSplitItemByOrderItemId(fromSplitId, orderItemId, req.db);
      }

      if (toSplitId) {
        await storage.createSplitItem({ splitId: toSplitId, orderItemId }, req.db);
      }

      broadcast("order_updated", {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/split-items/move-bulk", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const { orderItemIds, fromSplitId, toSplitId } = req.body;
      if (!orderItemIds || !Array.isArray(orderItemIds) || orderItemIds.length === 0) {
        return res.status(400).json({ message: "orderItemIds requerido (array)" });
      }

      await storage.bulkMoveSplitItems(orderItemIds, fromSplitId || null, toSplitId || null, req.db);

      broadcast("order_updated", {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/split-order", requirePermission("POS_SPLIT"), async (req, res) => {
    const t0 = Date.now();
    try {
      const { orderId } = req.body;
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status !== "OPEN" && order.status !== "IN_KITCHEN" && order.status !== "PREPARING" && order.status !== "READY") {
        return res.status(400).json({ message: "Orden no está abierta" });
      }

      const splits = await storage.getSplitAccountsForOrder(orderId, req.db);
      const splitsWithItems = [];
      for (const sp of splits) {
        const items = await storage.getSplitItemsForSplit(sp.id, req.db);
        if (items.length > 0) splitsWithItems.push({ ...sp, items });
      }

      if (splitsWithItems.length === 0) {
        return res.status(400).json({ message: "No hay subcuentas con items para separar" });
      }

      const allOrderItems = await storage.getOrderItems(orderId, req.db);
      const assignedItemIds = splitsWithItems.flatMap(s => s.items.map(si => si.orderItemId));
      const unassignedActive = allOrderItems.filter(i => !assignedItemIds.includes(i.id) && i.status !== "VOIDED" && i.status !== "PAID");

      const rootParentId = order.parentOrderId || orderId;
      const rootParent = order.parentOrderId ? await storage.getOrder(order.parentOrderId, req.db) : order;
      const parentDailyNumber = rootParent?.dailyNumber || order.dailyNumber || 0;
      const parentGlobalNumber = rootParent?.globalNumber || order.globalNumber;

      const existingSiblings = await storage.getChildOrders(rootParentId, req.db);
      const maxExistingSplitIdx = existingSiblings.reduce((max, s) => Math.max(max, s.splitIndex || 0), 0);

      const createdOrderIds: number[] = [];
      let splitIdx = maxExistingSplitIdx + 1;

      for (const sp of splitsWithItems) {
        const childOrder = await storage.createChildOrder({
          tableId: order.tableId!,
          status: "OPEN",
          responsibleWaiterId: order.responsibleWaiterId,
          businessDate: order.businessDate,
          totalAmount: "0",
          parentOrderId: rootParentId,
          splitIndex: splitIdx,
          dailyNumber: parentDailyNumber,
          globalNumber: parentGlobalNumber,
        }, req.db);

        for (const si of sp.items) {
          await storage.moveOrderItem(si.orderItemId, childOrder.id, req.db);
        }

        await storage.recalcOrderTotal(childOrder.id, req.db);
        createdOrderIds.push(childOrder.id);
        splitIdx++;
      }

      await storage.recalcOrderTotal(orderId, req.db);

      for (const sp of splits) {
        await storage.deleteSplitAccount(sp.id, req.db);
      }

      if (unassignedActive.length === 0) {
        await storage.updateOrder(orderId, { status: "SPLIT", closedAt: new Date() }, req.db);
      }

      broadcast("order_updated", { orderId });
      broadcast("table_status_changed", {});

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/split-order ${Date.now() - t0}ms (${createdOrderIds.length} splits)`);
      res.json({ ok: true, parentOrderId: orderId, childOrderIds: createdOrderIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/pay-split", requirePermission("POS_SPLIT"), async (req, res) => {
    const t0 = Date.now();
    try {
      const { splitId, paymentMethodId, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      const [splitAccount, splitItemsList, allPMs, cashSession] = await Promise.all([
        storage.getSplitAccount(splitId, req.db),
        storage.getSplitItemsForSplit(splitId, req.db),
        storage.getAllPaymentMethods(req.db),
        storage.getActiveCashSession(req.db),
      ]);

      if (!splitAccount) return res.status(404).json({ message: "Split no encontrado" });
      if (!splitItemsList.length) return res.status(400).json({ message: "Split sin items" });

      const orderId = splitAccount.orderId;
      const splitOrderItemIds = splitItemsList.map(si => si.orderItemId);

      const [orderItemsList, order] = await Promise.all([
        storage.getOrderItems(orderId, req.db),
        storage.getOrder(orderId, req.db),
      ]);

      const splitOIs = orderItemsList.filter(oi => splitOrderItemIds.includes(oi.id));
      const alreadyPaid = splitOIs.every(oi => oi.status === "PAID");
      if (alreadyPaid) return res.json({ ok: true, alreadyPaid: true });

      const [allMods, allDiscounts, allTaxes] = await Promise.all([
        storage.getOrderItemModifiersByItemIds(splitOrderItemIds, req.db),
        storage.getOrderItemDiscountsByItemIds(splitOrderItemIds, req.db),
        storage.getOrderItemTaxesByItemIds(splitOrderItemIds, req.db),
      ]);

      const modsMap = new Map<number, number>();
      for (const m of allMods) {
        modsMap.set(m.orderItemId, (modsMap.get(m.orderItemId) || 0) + Number(m.priceDeltaSnapshot) * m.qty);
      }
      const discMap = new Map<number, number>();
      for (const d of allDiscounts) {
        discMap.set(d.orderItemId, (discMap.get(d.orderItemId) || 0) + Number(d.amountApplied));
      }
      const taxMap = new Map<number, number>();
      for (const t of allTaxes) {
        if (!t.inclusiveSnapshot) {
          taxMap.set(t.orderItemId, (taxMap.get(t.orderItemId) || 0) + Number(t.taxAmount));
        }
      }

      let splitTotal = 0;
      for (const oi of splitOIs) {
        const modDelta = modsMap.get(oi.id) || 0;
        const lineSubtotal = (Number(oi.productPriceSnapshot) + modDelta) * oi.qty;
        const discountAmount = discMap.get(oi.id) || 0;
        const additiveTax = taxMap.get(oi.id) || 0;
        splitTotal += lineSubtotal - discountAmount + additiveTax;
      }

      const pm = allPMs.find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH" && !cashSession) {
        return res.status(400).json({ message: "No hay caja abierta. Abra una sesión de caja antes de cobrar en efectivo." });
      }

      const bd = await getBusinessDate(req.tenantSchema);
      const now = new Date();

      const payment = await storage.createPayment({
        orderId,
        splitId,
        amount: splitTotal.toFixed(2),
        paymentMethodId,
        cashierUserId: userId,
        status: "PAID",
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: bd,
      }, req.db);

      await req.db.transaction(async (tx) => {
        await finalizePaymentTx(tx, { orderId, itemIds: splitOrderItemIds, now });
      });

      const splitActiveOIs = splitOIs.filter(oi => oi.status !== "VOIDED");
      await buildServiceChargeOps(orderId, order!, splitActiveOIs, req.tenantSchema, req.db);

      if (pm?.paymentCode === "CASH" && cashSession) {
        const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) + splitTotal;
        await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) }, req.db);
      }

      await storage.recalcOrderTotal(orderId, req.db);
      await storage.updateOrderPaymentTotals(orderId, req.db);

      const allItems = await storage.getOrderItems(orderId, req.db);
      const allPaidNow = allItems.filter(i => i.status !== "VOIDED").every(i => i.status === "PAID");
      if (allPaidNow) {
        await storage.updateOrder(orderId, { status: "PAID", closedAt: now }, req.db);
        await cleanupSubaccountsForOrder(orderId, req.db);
      }

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      qbo.enqueueSyncForPayment(payment.id, orderId, req.db).catch(() => {});

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/pay-split ${Date.now() - t0}ms`);
      const paidItemIds = splitItemsList.map(si => si.orderItemId);
      res.json({ ok: true, paymentId: payment.id, splitLabel: splitAccount.label, paidItemIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PRINT RECEIPT (direct to printer) ====================
  app.post("/api/pos/print-receipt", requirePermission("POS_PRINT"), async (req, res) => {
    try {
      const { orderId, cashReceived, changeAmount, splitPaymentId, splitLabel, paidItemIds: bodyPaidItemIds } = req.body;
      if (!orderId || typeof orderId !== "number") return res.status(400).json({ message: "orderId requerido (número)" });

      const { buildReceiptBuffer, sendToPrinter } = await import("./escpos");

      const printersList = await req.db.select().from(printersTable).orderBy(asc(printersTable.name));
      const cajaPrinter = printersList.find(p => p.type === "caja" && p.enabled && p.ipAddress);
      if (!cajaPrinter) {
        return res.status(400).json({ message: "No hay impresora de caja configurada y habilitada" });
      }

      const config = await storage.getBusinessConfig(req.tenantSchema);
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const table = order.tableId ? await storage.getTable(order.tableId, req.db) : null;
      const items = await storage.getOrderItems(orderId, req.db);

      let targetItems: typeof items;

      if (splitPaymentId && Array.isArray(bodyPaidItemIds) && bodyPaidItemIds.length > 0) {
        const paidSet = new Set(bodyPaidItemIds as number[]);
        targetItems = items.filter(i => paidSet.has(i.id));
      } else if (splitPaymentId) {
        const splitPay = (await storage.getPaymentsForOrder(orderId, req.db)).find(p => p.id === splitPaymentId);
        if (splitPay && splitPay.splitId) {
          const splitItemsList = await storage.getSplitItemsForSplit(splitPay.splitId, req.db).catch(() => []);
          const splitItemOrderIds = new Set(splitItemsList.map(si => si.orderItemId));
          if (splitItemOrderIds.size > 0) {
            targetItems = items.filter(i => splitItemOrderIds.has(i.id));
          } else {
            return res.status(400).json({ message: "No se encontraron items para esta subcuenta. Datos de impresión no disponibles." });
          }
        } else {
          targetItems = items.filter(i => i.status !== "VOIDED");
        }
      } else {
        targetItems = items.filter(i => i.status !== "VOIDED");
      }

      const cashier = req.session.userId ? await storage.getUser(req.session.userId) : null;

      const receiptItems: { name: string; qty: number; price: number; total: number }[] = [];
      for (const i of targetItems) {
        const mods = await storage.getOrderItemModifiers(i.id, req.db);
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        receiptItems.push({
          name: i.productNameSnapshot + (mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : ""),
          qty: i.qty,
          price: Number(i.productPriceSnapshot) + modDelta,
          total: (Number(i.productPriceSnapshot) + modDelta) * i.qty,
        });
      }

      const oNum = order.globalNumber ? `G-${order.globalNumber}` : (order.dailyNumber ? `D-${order.dailyNumber}` : `#${order.id}`);
      const receiptOrderNum = splitLabel ? `${oNum} — ${splitLabel}` : oNum;

      const allPayments = (await storage.getPaymentsForOrder(orderId, req.db)).filter(p => p.status === "PAID");
      const relevantPayments = splitPaymentId
        ? allPayments.filter(p => p.id === splitPaymentId)
        : allPayments;
      const lastPayment = relevantPayments.length > 0 ? relevantPayments[relevantPayments.length - 1] : null;
      let paymentMethodName = "";
      let hasCashPayment = false;
      if (relevantPayments.length > 1) {
        const pmNames: string[] = [];
        for (const pay of relevantPayments) {
          const pm = await storage.getPaymentMethod(pay.paymentMethodId, req.db);
          if (pm) {
            pmNames.push(`${pm.paymentName} ₡${Number(pay.amount).toLocaleString()}`);
            if (pm.paymentCode === "CASH") hasCashPayment = true;
          }
        }
        paymentMethodName = pmNames.join(" + ");
      } else if (lastPayment) {
        const pm = await storage.getPaymentMethod(lastPayment.paymentMethodId, req.db);
        paymentMethodName = pm?.paymentName || "";
        if (pm?.paymentCode === "CASH") hasCashPayment = true;
      }

      const receiptTotal = splitPaymentId && lastPayment
        ? Number(lastPayment.amount)
        : Number(order.totalAmount);

      const itemIds = new Set(targetItems.map(i => i.id));
      const orderDiscountsList = (await storage.getOrderItemDiscountsByOrder(orderId, req.db)).filter(d => itemIds.has(d.orderItemId));
      const orderTaxesList = (await storage.getOrderItemTaxesByOrder(orderId, req.db)).filter(t => itemIds.has(t.orderItemId));
      const totalDiscounts = orderDiscountsList.reduce((s: number, d: any) => s + Number(d.amountApplied), 0);
      const totalTaxes = orderTaxesList.reduce((s: number, t: any) => s + Number(t.taxAmount), 0);

      const receiptData = {
        businessName: config?.businessName || "",
        legalName: config?.legalName || "",
        taxId: config?.taxId || "",
        address: config?.address || "",
        phone: config?.phone || "",
        email: config?.email || "",
        legalNote: config?.legalNote || "",
        orderNumber: receiptOrderNum,
        tableName: table?.tableName || "",
        items: receiptItems,
        totalAmount: receiptTotal,
        totalDiscounts: totalDiscounts > 0 ? totalDiscounts : undefined,
        totalTaxes: totalTaxes > 0 ? totalTaxes : undefined,
        taxBreakdown: orderTaxesList.length > 0 ? aggregateTaxBreakdown(orderTaxesList) : undefined,
        paymentMethod: paymentMethodName,
        cashReceived: typeof cashReceived === "number" && cashReceived > 0 ? cashReceived : undefined,
        changeAmount: typeof changeAmount === "number" && changeAmount > 0 ? changeAmount : undefined,
        clientName: lastPayment?.clientNameSnapshot || undefined,
        cashierName: cashier?.displayName || undefined,
        date: new Date().toLocaleString("es-CR"),
        openDrawer: hasCashPayment,
      };

      const buffer = buildReceiptBuffer(receiptData, cajaPrinter.paperWidth);

      const dispatch = (app as any).dispatchPrintJob;
      if (typeof dispatch === "function") {
        const sent = dispatch({
          jobType: "raw",
          destination: cajaPrinter.type || "caja",
          payload: { raw: buffer.toString("base64") }
        });
        if (!sent) {
          return res.status(503).json({ message: "No hay Print Bridge conectado" });
        }
        res.json({ ok: true, printer: cajaPrinter.name, via: "bridge" });
      } else {
        await sendToPrinter(cajaPrinter.ipAddress, cajaPrinter.port, buffer);
        res.json({ ok: true, printer: cajaPrinter.name, via: "direct" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PRINT PRE-CUENTA ====================
  app.post("/api/pos/print-precuenta", requirePermission("POS_PRINT"), async (req, res) => {
    try {
      const { orderId } = req.body;
      if (!orderId || typeof orderId !== "number") return res.status(400).json({ message: "orderId requerido (número)" });

      const { buildReceiptBuffer, sendToPrinter } = await import("./escpos");

      const printersList = await req.db.select().from(printersTable).orderBy(asc(printersTable.name));
      const cajaPrinter = printersList.find(p => p.type === "caja" && p.enabled && p.ipAddress);
      if (!cajaPrinter) {
        return res.status(400).json({ message: "No hay impresora de caja configurada y habilitada" });
      }

      const config = await storage.getBusinessConfig(req.tenantSchema);
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const table = order.tableId ? await storage.getTable(order.tableId, req.db) : null;
      const items = await storage.getOrderItems(orderId, req.db);
      const activeItems = items.filter(i => i.status !== "VOIDED");

      const cashier = req.session.userId ? await storage.getUser(req.session.userId) : null;

      const receiptItems: { name: string; qty: number; price: number; total: number }[] = [];
      for (const i of activeItems) {
        const mods = await storage.getOrderItemModifiers(i.id, req.db);
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        receiptItems.push({
          name: i.productNameSnapshot + (mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${Number(m.priceDeltaSnapshot)}` : "")).join(", ")})` : ""),
          qty: i.qty,
          price: Number(i.productPriceSnapshot) + modDelta,
          total: (Number(i.productPriceSnapshot) + modDelta) * i.qty,
        });
      }

      const oNum = order.globalNumber ? `G-${order.globalNumber}` : (order.dailyNumber ? `D-${order.dailyNumber}` : `#${order.id}`);

      const orderDiscountsList = await storage.getOrderItemDiscountsByOrder(orderId, req.db);
      const orderTaxesList = await storage.getOrderItemTaxesByOrder(orderId, req.db);
      const totalDiscounts = orderDiscountsList.reduce((s: number, d: any) => s + Number(d.amountApplied), 0);
      const totalTaxes = orderTaxesList.reduce((s: number, t: any) => s + Number(t.taxAmount), 0);

      const receiptData = {
        businessName: config?.businessName || "",
        legalName: config?.legalName || "",
        taxId: config?.taxId || "",
        address: config?.address || "",
        phone: config?.phone || "",
        email: config?.email || "",
        legalNote: config?.legalNote || "",
        orderNumber: oNum,
        tableName: table?.tableName || "",
        items: receiptItems,
        totalAmount: Number(order.totalAmount),
        totalDiscounts: totalDiscounts > 0 ? totalDiscounts : undefined,
        totalTaxes: totalTaxes > 0 ? totalTaxes : undefined,
        taxBreakdown: orderTaxesList.length > 0 ? aggregateTaxBreakdown(orderTaxesList) : undefined,
        paymentMethod: "PRE-CUENTA",
        cashierName: cashier?.displayName || undefined,
        date: new Date().toLocaleString("es-CR"),
      };

      const buffer = buildReceiptBuffer(receiptData, cajaPrinter.paperWidth);

      const dispatch = (app as any).dispatchPrintJob;
      if (typeof dispatch === "function") {
        const sent = dispatch({
          jobType: "raw",
          destination: cajaPrinter.type || "caja",
          payload: { raw: buffer.toString("base64") }
        });
        if (!sent) {
          return res.status(503).json({ message: "No hay Print Bridge conectado" });
        }
        res.json({ ok: true, printer: cajaPrinter.name, via: "bridge" });
      } else {
        await sendToPrinter(cajaPrinter.ipAddress, cajaPrinter.port, buffer);
        res.json({ ok: true, printer: cajaPrinter.name, via: "direct" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: OPEN CASH DRAWER ====================
  app.post("/api/pos/open-drawer", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const { buildDrawerKickData, sendToPrinter } = await import("./escpos");
      const printersList = await req.db.select().from(printersTable).orderBy(asc(printersTable.name));
      const cajaPrinter = printersList.find(p => p.type === "caja" && p.enabled);
      if (!cajaPrinter) {
        return res.json({ ok: false, message: "No hay impresora de caja configurada" });
      }
      const drawerData = buildDrawerKickData();

      const dispatch = (app as any).dispatchPrintJob;
      if (cajaPrinter.bridgeId && typeof dispatch === "function") {
        const sent = dispatch({
          jobType: "raw",
          destination: cajaPrinter.type || "caja",
          payload: { raw: drawerData.toString("base64") }
        });
        if (!sent) {
          return res.json({ ok: false, message: "No hay Print Bridge conectado" });
        }
        res.json({ ok: true, printer: cajaPrinter.name, via: "bridge" });
      } else if (cajaPrinter.ipAddress) {
        await sendToPrinter(cajaPrinter.ipAddress, cajaPrinter.port, drawerData);
        res.json({ ok: true, printer: cajaPrinter.name, via: "direct" });
      } else {
        return res.json({ ok: false, message: "Impresora de caja sin bridge ni IP configurado" });
      }
    } catch (err: any) {
      res.json({ ok: false, message: err.message });
    }
  });

  // ==================== POS: SEND TICKET (email) ====================
  app.post("/api/pos/send-ticket", requirePermission("POS_EMAIL_TICKET"), async (req, res) => {
    try {
      const { orderId, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      if (!orderId || !clientEmail) {
        return res.status(400).json({ message: "orderId y clientEmail son requeridos" });
      }

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      if (order.status !== "PAID" && order.status !== "OPEN" && order.status !== "IN_KITCHEN" && order.status !== "PREPARING" && order.status !== "READY") {
        return res.status(400).json({ message: "No se puede enviar tiquete para esta orden" });
      }

      const items = await storage.getOrderItems(orderId, req.db);
      const activeItems = items.filter(i => i.status !== "VOIDED");
      const table = await storage.getTable(order.tableId!, req.db);
      let subtotal = 0;
      const emailItemsData: { name: string; qty: number; lineTotal: number }[] = [];
      for (const i of activeItems) {
        const mods = await storage.getOrderItemModifiers(i.id, req.db);
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        const lineTotal = (Number(i.productPriceSnapshot) + modDelta) * i.qty;
        subtotal += lineTotal;
        const modLabel = mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : "";
        emailItemsData.push({ name: i.productNameSnapshot + modLabel, qty: i.qty, lineTotal });
      }
      const orderDiscountsList = await storage.getOrderItemDiscountsByOrder(orderId, req.db);
      const orderTaxesList = await storage.getOrderItemTaxesByOrder(orderId, req.db);
      const totalDiscounts = orderDiscountsList.reduce((s: number, d: any) => s + Number(d.amountApplied), 0);
      const totalTaxes = orderTaxesList.reduce((s: number, t: any) => s + Number(t.taxAmount), 0);
      const taxBk = orderTaxesList.length > 0 ? aggregateTaxBreakdown(orderTaxesList) : [];
      const total = Number(order.totalAmount);

      let emailSent = false;
      let emailError = "";

      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || (smtpUser ? `La Antigua Lechería <${smtpUser}>` : undefined);
      const dateStr = await getBusinessDate(req.tenantSchema);

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.default.createTransport({
            host: smtpHost,
            port: Number(process.env.SMTP_PORT || "587"),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: smtpUser, pass: smtpPass },
          });

          const itemRows = emailItemsData.map(i =>
            `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${i.name}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">₡${i.lineTotal.toLocaleString()}</td></tr>`
          ).join("");

          const breakdownHtml = `
              <table style="width:100%;margin:8px 0">
                <tr><td style="padding:2px 8px">Subtotal</td><td style="padding:2px 8px;text-align:right">₡${subtotal.toLocaleString()}</td></tr>
                ${taxBk.length > 0 ? taxBk.map(tb => `<tr><td style="padding:2px 8px;color:#666">${tb.taxName}${tb.inclusive ? " (ii)" : ""}</td><td style="padding:2px 8px;text-align:right;color:#666">${tb.inclusive ? "" : "+"}₡${Number(tb.totalAmount).toLocaleString()}</td></tr>`).join("") : `<tr><td style="padding:2px 8px;color:#666">Impuestos</td><td style="padding:2px 8px;text-align:right;color:#666">₡0</td></tr>`}
                <tr><td style="padding:2px 8px;${totalDiscounts > 0 ? "color:#16a34a" : "color:#666"}">Descuentos</td><td style="padding:2px 8px;text-align:right;${totalDiscounts > 0 ? "color:#16a34a" : "color:#666"}">${totalDiscounts > 0 ? `-₡${totalDiscounts.toLocaleString()}` : "₡0"}</td></tr>
              </table>`;

          const html = `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
              <h2 style="color:#333">Ticket de Consumo</h2>
              <p><strong>Mesa:</strong> ${table?.tableName || "N/A"}</p>
              ${clientName ? `<p><strong>Cliente:</strong> ${clientName}</p>` : ""}
              <p><strong>Fecha:</strong> ${new Date().toLocaleString("es-CR")}</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <thead><tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:left">Producto</th><th style="padding:6px 8px;text-align:center">Cant</th><th style="padding:6px 8px;text-align:right">Subtotal</th></tr></thead>
                <tbody>${itemRows}</tbody>
              </table>
              ${breakdownHtml}
              <p style="font-size:18px;font-weight:bold;text-align:right">Total a pagar: ₡${total.toLocaleString()}</p>
              <p style="color:#999;font-size:12px;margin-top:24px;text-align:center">Gracias por su visita</p>
            </div>`;

          const textLines = emailItemsData.map(i => `${i.qty}x ${i.name} - ₡${i.lineTotal.toLocaleString()}`);
          const breakdownText = [
            `Subtotal: ₡${subtotal.toLocaleString()}`,
            ...(taxBk.length > 0 ? taxBk.map(tb => `${tb.taxName}${tb.inclusive ? " (ii)" : ""}: ${tb.inclusive ? "" : "+"}₡${Number(tb.totalAmount).toLocaleString()}`) : [`Impuestos: ₡0`]),
            `Descuentos: ${totalDiscounts > 0 ? `-₡${totalDiscounts.toLocaleString()}` : "₡0"}`,
          ];
          const text = [
            `Ticket de Consumo`,
            `Mesa: ${table?.tableName || "N/A"}`,
            clientName ? `Cliente: ${clientName}` : "",
            `Fecha: ${new Date().toLocaleString("es-CR")}`,
            `---`,
            ...textLines,
            `---`,
            ...breakdownText,
            `Total a pagar: ₡${total.toLocaleString()}`,
            ``,
            `Gracias por su visita`,
          ].filter(Boolean).join("\n");

          await transporter.sendMail({
            from: smtpFrom,
            to: clientEmail,
            subject: `Ticket - ${table?.tableName || "Mesa"} - ${dateStr}`,
            html,
            text,
          });
          emailSent = true;
        } catch (mailErr: any) {
          emailError = mailErr.message;
        }
      } else {
        emailError = "SMTP no configurado (variables: SMTP_HOST, SMTP_USER, SMTP_PASS)";
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "TICKET_SENT",
        entityType: "order",
        entityId: orderId,
        tableId: order.tableId,
        metadata: { clientName, clientEmail, orderStatus: order.status, sentAt: new Date().toISOString(), emailSent, emailError: emailError || undefined },
      });

      if (emailSent) {
        res.json({ ok: true, message: "Ticket enviado por email" });
      } else {
        res.json({ ok: true, message: `Ticket registrado. ${emailError}`, emailConfigured: false });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: VOID ORDER (entire table) ====================
  app.post("/api/pos/void-order/:orderId", requirePermission("POS_VOID_ORDER"), async (req, res) => {
    const t0 = Date.now();
    try {
      const orderId = parseInt(req.params.orderId as string);
      const userId = req.session.userId!;
      const { reason } = req.body || {};

      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "Usuario no encontrado" });

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status === "PAID") return res.status(400).json({ message: "No se puede anular una orden ya pagada" });
      if (order.status === "VOIDED") return res.status(400).json({ message: "La orden ya está anulada" });

      const [items, table, allCategories] = await Promise.all([
        storage.getOrderItems(orderId, req.db),
        storage.getTable(order.tableId!, req.db),
        storage.getAllCategories(req.db),
      ]);

      const activeItems = items.filter(i => i.status !== "VOIDED");
      const productIds = Array.from(new Set(activeItems.map(i => i.productId)));
      const allProducts = await storage.getProductsByIds(productIds, req.db);
      const productMap = new Map(allProducts.map(p => [p.id, p]));

      const activeItemIds = activeItems.map(i => i.id);
      if (activeItemIds.length > 0) {
        const now = new Date();
        await req.db.update(orderItems)
          .set({ status: "VOIDED", voidedAt: now, voidedByUserId: userId })
          .where(inArray(orderItems.id, activeItemIds));
        await req.db.update(salesLedgerItems)
          .set({ status: "VOIDED" })
          .where(inArray(salesLedgerItems.orderItemId, activeItemIds));
      }

      const fallbackBizDate = order.businessDate || await getBusinessDate(req.tenantSchema);
      const voidInserts = activeItems.map(item => {
        const product = productMap.get(item.productId);
        const category = allCategories.find(c => c.id === product?.categoryId);
        return {
          businessDate: fallbackBizDate,
          tableId: order.tableId,
          tableNameSnapshot: table?.tableName || null,
          orderId,
          orderItemId: item.id,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot,
          categorySnapshot: category?.name || null,
          qtyVoided: item.qty,
          unitPriceSnapshot: item.productPriceSnapshot,
          voidReason: reason || "Anulación de orden completa",
          voidedByUserId: userId,
          voidedByRole: user.role,
          status: "VOIDED" as const,
          notes: null,
        };
      });
      if (voidInserts.length > 0) {
        await req.db.insert(voidedItems).values(voidInserts);
      }

      const sentItemIds2 = activeItems.filter(i => i.sentToKitchenAt).map(i => i.id);
      if (sentItemIds2.length > 0) {
        await req.db.update(kitchenTicketItems)
          .set({ status: "VOIDED" })
          .where(inArray(kitchenTicketItems.orderItemId, sentItemIds2));
      }

      const sentItemIds = items
        .filter(i => i.status !== "VOIDED" && i.sentToKitchenAt)
        .map(i => i.id);
      if (sentItemIds.length > 0) {
        try { await onOrderItemsVoided(sentItemIds, userId); } catch (e) { console.error("[inv] order void reversal error:", e); }
      }

      await storage.updateOrder(orderId, { status: "VOIDED", closedAt: new Date(), totalAmount: "0" }, req.db);
      await cleanupSubaccountsForOrder(orderId, req.db);

      if (order.parentOrderId) {
        const siblings = await storage.getChildOrders(order.parentOrderId, req.db);
        const allDone = siblings.every(s => s.status === "PAID" || s.status === "VOIDED");
        if (allDone) {
          const anyPaid = siblings.some(s => s.status === "PAID");
          const parentOrder = await storage.getOrder(order.parentOrderId, req.db);
          if (parentOrder) {
            const parentItems = await storage.getOrderItems(order.parentOrderId, req.db);
            const parentActive = parentItems.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
            if (parentActive.length === 0) {
              const finalStatus = anyPaid ? "PAID" : "VOIDED";
              await storage.updateOrder(order.parentOrderId, { status: finalStatus, closedAt: new Date() }, req.db);
              await cleanupSubaccountsForOrder(order.parentOrderId, req.db);
            }
          }
        }
      }

      // Delete any split accounts
      const splits = await storage.getSplitAccountsForOrder(orderId, req.db);
      for (const split of splits) {
        await storage.deleteSplitAccount(split.id, req.db);
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "ORDER_VOIDED",
        entityType: "order",
        entityId: orderId,
        tableId: order.tableId,
        metadata: {
          tableName: table?.tableName,
          itemCount: items.filter(i => i.status !== "VOIDED").length,
          reason: reason || "Anulación de orden completa",
          role: user.role,
        },
      });

      broadcast("order_updated", { tableId: order.tableId, orderId });
      broadcast("table_status_changed", { tableId: order.tableId });

      if (Date.now() - t0 > 200) console.log(`[PERF] POST /api/pos/void-order/${orderId} ${Date.now() - t0}ms`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: VOID PAYMENT ====================
  app.post("/api/pos/void-payment/:id", requirePermission("PAYMENT_CORRECT"), async (req, res) => {
    try {
      const paymentId = parseInt(req.params.id as string);
      const userId = req.session.userId!;

      const payment = await storage.getPayment(paymentId, req.db);
      if (!payment) return res.status(404).json({ message: "Pago no encontrado" });
      if (payment.status !== "PAID") return res.status(400).json({ message: "Este pago ya fue anulado" });

      await storage.voidPayment(paymentId, userId, req.body.voidReason || "Anulación de pago", req.db);

      const pm = (await storage.getAllPaymentMethods(req.db)).find(m => m.id === payment.paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession(req.db);
        if (cashSession) {
          const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) - Number(payment.amount);
          await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) }, req.db);
        }
      }

      const { balanceDue } = await storage.updateOrderPaymentTotals(payment.orderId, req.db);

      const order = await storage.getOrder(payment.orderId, req.db);
      if (order && order.status === "PAID" && balanceDue > 0) {
        await storage.updateOrder(payment.orderId, { status: "OPEN", closedAt: null }, req.db);
        await storage.voidServiceChargeByOrder(payment.orderId, req.db);
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "PAYMENT_VOIDED",
        entityType: "payment",
        entityId: paymentId,
        tableId: order?.tableId || null,
        metadata: { orderId: payment.orderId, amount: payment.amount, voidReason: req.body.voidReason },
      });

      broadcast("payment_voided", { orderId: payment.orderId, paymentId });
      broadcast("table_status_changed", {});
      broadcast("order_updated", { orderId: payment.orderId });

      qbo.voidSalesReceipt(paymentId, req.db).catch(() => {});

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: RECEIPT DATA (for screen print) ====================
  app.get("/api/pos/receipt-data/:orderId", requirePermission("POS_PRINT"), async (req, res) => {
    const t0 = Date.now();
    try {
      const orderId = parseInt(req.params.orderId as string);
      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const [table, items, orderPayments, allPaymentMethods] = await Promise.all([
        storage.getTable(order.tableId!, req.db),
        storage.getOrderItems(orderId, req.db),
        storage.getPaymentsForOrder(orderId, req.db),
        storage.getAllPaymentMethods(req.db),
      ]);
      const pmMap = new Map(allPaymentMethods.map(m => [m.id, m.paymentName]));
      const activeItems = items.filter(i => i.status !== "VOIDED");
      const paidPayments = orderPayments.filter(p => p.status === "PAID");
      const paymentMethodName = paidPayments.length > 0 ? paidPayments.map(p => pmMap.get(p.paymentMethodId) || "Efectivo").join(", ") : "";

      let orderNumber = "";
      if (order.dailyNumber) {
        orderNumber = `#${order.dailyNumber}`;
        if (order.splitIndex) orderNumber += `-${order.splitIndex}`;
      }

      const activeItemIds = activeItems.map(i => i.id);
      const [allMods, orderDiscountsList, orderTaxesList] = await Promise.all([
        storage.getOrderItemModifiersByItemIds(activeItemIds, req.db),
        storage.getOrderItemDiscountsByOrder(orderId, req.db),
        storage.getOrderItemTaxesByOrder(orderId, req.db),
      ]);

      const modsMap = new Map<number, typeof allMods>();
      for (const m of allMods) {
        if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []);
        modsMap.get(m.orderItemId)!.push(m);
      }

      const receiptItems: { name: string; qty: number; price: number; total: number }[] = [];
      for (const i of activeItems) {
        const mods = modsMap.get(i.id) || [];
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        const unitPrice = Number(i.productPriceSnapshot) + modDelta;
        const modLabel = mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : "";
        receiptItems.push({
          name: i.productNameSnapshot + modLabel,
          qty: i.qty,
          price: unitPrice,
          total: unitPrice * i.qty,
        });
      }
      const totalDiscounts = orderDiscountsList.reduce((s: number, d: any) => s + Number(d.amountApplied), 0);
      const totalTaxes = orderTaxesList.reduce((s: number, t: any) => s + Number(t.taxAmount), 0);
      const taxBreakdown = orderTaxesList.length > 0 ? aggregateTaxBreakdown(orderTaxesList) : [];

      const receiptResult = {
        items: receiptItems,
        total: Number(order.totalAmount),
        paymentMethod: paymentMethodName,
        tableName: table?.tableName || `Mesa ${order.tableId}`,
        orderNumber,
        clientName: paidPayments[0]?.clientNameSnapshot || undefined,
        totalDiscounts,
        totalTaxes,
        taxBreakdown,
      };
      if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/receipt-data/${orderId} ${Date.now() - t0}ms`);
      res.json(receiptResult);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PAID ORDERS LIST ====================
  app.get("/api/pos/paid-orders", requirePermission("MODULE_POS_VIEW"), async (req, res) => {
    const t0 = Date.now();
    try {
      const date = (req.query.date as string) || undefined;
      const [paidOrders, allTables] = await Promise.all([
        storage.getPaidOrdersForDate(date, undefined, req.db),
        storage.getAllTables(false, req.db),
      ]);
      const tableMap = new Map(allTables.map(t => [t.id, t]));

      if (paidOrders.length === 0) return res.json([]);

      const orderIds = paidOrders.map(o => o.id);
      const [allItems, allPaymentsList, allPaymentMethods] = await Promise.all([
        storage.getOrderItemsByOrderIds(orderIds, req.db),
        storage.getPaymentsByOrderIds(orderIds, req.db),
        storage.getAllPaymentMethods(req.db),
      ]);
      const pmNameMap = new Map(allPaymentMethods.map(m => [m.id, m.paymentName]));

      const itemsByOrder = new Map<number, typeof allItems>();
      for (const item of allItems) {
        if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
        itemsByOrder.get(item.orderId)!.push(item);
      }

      const paymentsByOrder = new Map<number, typeof allPaymentsList>();
      for (const p of allPaymentsList) {
        if (!paymentsByOrder.has(p.orderId)) paymentsByOrder.set(p.orderId, []);
        paymentsByOrder.get(p.orderId)!.push(p);
      }

      const result = paidOrders.map(order => {
        const table = order.tableId ? tableMap.get(order.tableId) : undefined;
        const items = itemsByOrder.get(order.id) || [];
        const activeItems = items.filter(i => i.status !== "VOIDED");
        const orderPayments = paymentsByOrder.get(order.id) || [];
        const paidPayments = orderPayments.filter(p => p.status === "PAID");
        const paymentMethodNames = paidPayments.map(p => pmNameMap.get(p.paymentMethodId) || "Efectivo");

        let ticketNumber = "";
        if (order.dailyNumber) {
          ticketNumber = `#${order.dailyNumber}`;
          if (order.splitIndex) ticketNumber += `-${order.splitIndex}`;
        }

        return {
          orderId: order.id,
          tableName: table?.tableName || `Mesa ${order.tableId}`,
          ticketNumber,
          dailyNumber: order.dailyNumber,
          splitIndex: order.splitIndex,
          totalAmount: order.totalAmount,
          closedAt: order.closedAt,
          paymentMethods: paymentMethodNames,
          itemCount: activeItems.length,
          items: activeItems.map(i => ({
            id: i.id,
            productNameSnapshot: i.productNameSnapshot,
            qty: i.qty,
            productPriceSnapshot: i.productPriceSnapshot,
          })),
        };
      });

      if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/pos/paid-orders ${Date.now() - t0}ms (${result.length} orders)`);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: REOPEN TABLE ====================
  app.post("/api/pos/reopen/:orderId", requirePermission("PAYMENT_CORRECT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId, req.db);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status !== "PAID") return res.status(400).json({ message: "Solo se pueden reabrir ordenes pagadas" });

      const orderPayments = await storage.getPaymentsForOrder(orderId, req.db);
      const paidPayments = orderPayments.filter(p => p.status === "PAID");
      const allPMs = await storage.getAllPaymentMethods(req.db);
      const pmMap = new Map(allPMs.map(m => [m.id, m]));

      for (const p of paidPayments) {
        await storage.voidPayment(p.id, userId, "Reapertura de orden", req.db);
        const pm = pmMap.get(p.paymentMethodId);
        if (pm?.paymentCode === "CASH") {
          const cashSession = await storage.getActiveCashSession(req.db);
          if (cashSession) {
            const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) - Number(p.amount);
            await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) }, req.db);
          }
        }
      }

      await storage.updateOrderPaymentTotals(orderId, req.db);
      await storage.updateOrder(orderId, { status: "OPEN", closedAt: null }, req.db);

      const orderItemsList = await storage.getOrderItems(orderId, req.db);
      for (const item of orderItemsList) {
        if (item.status === "PAID") {
          await storage.updateOrderItem(item.id, { status: "OPEN" }, req.db);
          await storage.updateSalesLedgerItems(item.id, { status: "OPEN", paidAt: null }, req.db);
        }
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "ORDER_REOPENED",
        entityType: "order",
        entityId: orderId,
        tableId: order.tableId,
        metadata: { voidedPaymentCount: paidPayments.length },
      });

      broadcast("order_updated", { orderId, tableId: order.tableId });
      broadcast("table_status_changed", { tableId: order.tableId });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== QBO EXPORT ====================
  app.post("/api/qbo/export", requireRole("MANAGER"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const date = await getBusinessDate(req.tenantSchema);

      const job = await storage.createQboExportJob({
        businessDate: date,
        status: "PENDING",
        startedAt: new Date(),
        retryCount: 0,
      }, req.db);

      const ledgerItems = await storage.getLedgerItemsForDate(date, "PAID", req.db);
      const paidPayments = await storage.getPaymentsForDate(date, req.db);
      const activePaidPayments = paidPayments.filter(p => p.status === "PAID");

      const ledgerSum = ledgerItems.reduce((s, i) => s + Number(i.lineSubtotal), 0);
      const paymentSum = activePaidPayments.reduce((s, p) => s + Number(p.amount), 0);

      if (Math.abs(ledgerSum - paymentSum) < 0.01) {
        await storage.updateQboExportJob(job.id, {
          status: "SUCCESS",
          finishedAt: new Date(),
          qboRefs: { ledgerTotal: ledgerSum, paymentTotal: paymentSum, itemCount: ledgerItems.length },
        }, req.db);
      } else {
        await storage.updateQboExportJob(job.id, {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: `Mismatch: ledger=${ledgerSum.toFixed(2)}, payments=${paymentSum.toFixed(2)}`,
        }, req.db);
      }

      const updatedJob = await storage.getQboExportJobs(date, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "QBO_EXPORT_CREATED",
        entityType: "qbo_export_job",
        entityId: job.id,
        tableId: null,
        metadata: { date, ledgerSum, paymentSum },
      });

      res.json(updatedJob);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== QBO: GET EXPORT JOBS ====================
  app.get("/api/qbo/export", requireRole("MANAGER"), async (req, res) => {
    const today = await getBusinessDate(req.tenantSchema);
    const jobs = await storage.getQboExportJobs(today, req.db);
    res.json(jobs);
  });

  // ==================== DASHBOARD ====================
  app.get("/api/dashboard", requireRole("MANAGER"), async (req, res) => {
    const t0 = Date.now();
    const dateFrom = typeof req.query.from === "string" ? req.query.from : undefined;
    const dateTo = typeof req.query.to === "string" ? req.query.to : undefined;
    const hourFrom = typeof req.query.hourFrom === "string" ? parseInt(req.query.hourFrom) : undefined;
    const hourTo = typeof req.query.hourTo === "string" ? parseInt(req.query.hourTo) : undefined;
    const resolvedFrom = dateFrom || await getBusinessDate(req.tenantSchema);
    const resolvedTo = dateTo || resolvedFrom;
    const [data, ledgerDetails, paymentMethodTotals] = await Promise.all([
      storage.getDashboardData(dateFrom, dateTo, hourFrom, hourTo, req.tenantSchema, await getTenantTimezone(req.tenantSchema), req.db),
      resolvedFrom === resolvedTo
        ? storage.getLedgerItemsForDate(resolvedFrom, undefined, req.db)
        : storage.getLedgerItemsForDateRange(resolvedFrom, resolvedTo, req.db),
      resolvedFrom === resolvedTo
        ? storage.getPaymentsByDateGrouped(resolvedFrom, req.db)
        : storage.getPaymentsByDateRangeGrouped(resolvedFrom, resolvedTo, req.db),
    ]);
    if (Date.now() - t0 > 200) console.log(`[PERF] GET /api/dashboard ${Date.now() - t0}ms`);
    res.json({ ...data, ledgerDetails, paymentMethodTotals });
  });

  app.get("/api/dashboard/orders/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.id as string);
      const detail = await storage.getOrderDetail(orderId, req.db);
      if (!detail) return res.status(404).json({ message: "Orden no encontrada" });
      res.json(detail);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== HR MODULE ====================

  // -- HR Settings --
  app.get("/api/hr/settings", requirePermission("HR_MANAGE_SETTINGS"), async (req, res) => {
    const settings = await storage.getHrSettings(req.db);
    res.json(settings || {});
  });

  app.put("/api/hr/settings", requirePermission("HR_MANAGE_SETTINGS"), async (req, res) => {
    try {
      const settings = await storage.upsertHrSettings(req.body, req.db);
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "HR_SETTINGS_UPDATED",
        entityType: "HR_SETTINGS",
        metadata: req.body,
      });
      broadcast("hr_settings_updated", settings);
      res.json(settings);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- Weekly Schedules --
  app.get("/api/hr/schedules", requirePermission("HR_MANAGE_SCHEDULES", "HR_VIEW_TEAM"), async (req, res) => {
    const weekStartDate = req.query.weekStartDate as string;
    if (!weekStartDate) return res.status(400).json({ message: "weekStartDate required" });
    const schedules = await storage.getWeeklySchedulesByWeek(weekStartDate, req.db);
    const result = [];
    for (const s of schedules) {
      const days = await storage.getScheduleDays(s.id, req.db);
      result.push({ ...s, days });
    }
    res.json(result);
  });

  app.get("/api/hr/schedules/my", requirePermission("HR_VIEW_SELF"), async (req, res) => {
    const weekStartDate = req.query.weekStartDate as string;
    if (!weekStartDate) return res.status(400).json({ message: "weekStartDate required" });
    const schedule = await storage.getWeeklySchedule(req.session.userId!, weekStartDate, req.db);
    if (!schedule) return res.json(null);
    const days = await storage.getScheduleDays(schedule.id, req.db);
    res.json({ ...schedule, days });
  });

  app.post("/api/hr/schedules", requirePermission("HR_MANAGE_SCHEDULES"), async (req, res) => {
    try {
      const { employeeId, weekStartDate, days } = req.body;
      if (!employeeId || !weekStartDate) return res.status(400).json({ message: "employeeId and weekStartDate required" });
      
      const existing = await storage.getWeeklySchedule(employeeId, weekStartDate, req.db);
      if (existing) return res.status(409).json({ message: "Schedule already exists for this employee/week" });
      
      const schedule = await storage.createWeeklySchedule({ employeeId, weekStartDate }, req.db);
      let savedDays: any[] = [];
      if (days && Array.isArray(days) && days.length > 0) {
        savedDays = await storage.upsertScheduleDays(schedule.id, days, req.db);
      }
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "SCHEDULE_CREATED",
        entityType: "HR_SCHEDULE",
        entityId: schedule.id,
        metadata: { employeeId, weekStartDate },
      });
      broadcast("schedule_updated", { employeeId, weekStartDate });
      res.json({ ...schedule, days: savedDays });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/hr/schedules/:id", requirePermission("HR_MANAGE_SCHEDULES"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { days } = req.body;
      const schedule = await storage.updateWeeklySchedule(id, {}, req.db);
      let savedDays: any[] = [];
      if (days && Array.isArray(days)) {
        savedDays = await storage.upsertScheduleDays(id, days, req.db);
      }
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "SCHEDULE_UPDATED",
        entityType: "HR_SCHEDULE",
        entityId: id,
        metadata: { days },
      });
      broadcast("schedule_updated", { employeeId: schedule.employeeId, weekStartDate: schedule.weekStartDate });
      res.json({ ...schedule, days: savedDays });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/hr/schedules/:id", requirePermission("HR_MANAGE_SCHEDULES"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteWeeklySchedule(id, req.db);
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "SCHEDULE_DELETED",
        entityType: "HR_SCHEDULE",
        entityId: id,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- Time Punches: Clock-in --
  app.post("/api/hr/clock-in", requirePermission("HR_CLOCK_IN_OUT_ALLOW"), async (req, res) => {
    try {
      const employeeId = req.session.userId!;
      const { confirmNoSchedule } = req.body;
      
      const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);
      if (openPunch) return res.status(409).json({ message: "Ya tiene una entrada abierta. Marque salida primero." });
      
      const settings = await storage.getHrSettings(req.db);
      const tzSelf = await getTenantTimezone(req.tenantSchema);
      const now = new Date();
      const localNow = getNowInTZ(tzSelf);
      const businessDate = await getBusinessDate(req.tenantSchema);
      
      const weekDay = localNow.getDay();
      let lateMinutes = 0;
      let scheduledStartAt: Date | undefined;
      let scheduledEndAt: Date | undefined;
      
      const dayOffset = weekDay === 0 ? 6 : weekDay - 1;
      const mondayDate = new Date(localNow);
      mondayDate.setDate(mondayDate.getDate() - dayOffset);
      const weekStartDate = mondayDate.toLocaleDateString("en-CA", { timeZone: tzSelf });
      
      let hasScheduleToday = false;
      const schedule = await storage.getWeeklySchedule(employeeId, weekStartDate, req.db);
      if (schedule) {
        const days = await storage.getScheduleDays(schedule.id, req.db);
        const todaySchedule = days.find(d => d.dayOfWeek === weekDay);
        if (todaySchedule && !todaySchedule.isDayOff && todaySchedule.startTime) {
          hasScheduleToday = true;
          const [h, m] = todaySchedule.startTime.split(":").map(Number);
          scheduledStartAt = new Date(localNow);
          scheduledStartAt.setHours(h, m, 0, 0);
          
          if (todaySchedule.endTime) {
            const [eh, em] = todaySchedule.endTime.split(":").map(Number);
            scheduledEndAt = new Date(localNow);
            scheduledEndAt.setHours(eh, em, 0, 0);
          }
          
          const graceMinutes = settings?.latenessGraceMinutes || 0;
          const diffMs = localNow.getTime() - scheduledStartAt.getTime();
          const diffMinutes = Math.floor(diffMs / 60000);
          if (diffMinutes > graceMinutes) {
            lateMinutes = diffMinutes - graceMinutes;
          }
        }
      }
      
      if (!hasScheduleToday && !confirmNoSchedule) {
        return res.json({ requireConfirm: true, message: "No tiene horario hoy. Confirme para continuar." });
      }
      
      const punch = await storage.createTimePunch({
        employeeId,
        businessDate,
        clockInAt: now,
        scheduledStartAt: scheduledStartAt || null,
        scheduledEndAt: scheduledEndAt || null,
        lateMinutes,
        clockinGeoLat: null,
        clockinGeoLng: null,
        clockinGeoAccuracyM: null,
        clockinGeoVerified: false,
      }, req.db);
      
      const auditAction = hasScheduleToday ? "CLOCK_IN" : "CLOCK_IN_NO_SCHEDULE_CONFIRMED";
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: employeeId,
        action: auditAction,
        entityType: "HR_PUNCH",
        entityId: punch.id,
        metadata: { lateMinutes, geoVerified: false, hasScheduleToday },
      });
      
      if (lateMinutes > 0) {
        const user = await storage.getUser(employeeId);
        sendHrAlertEmail(settings,
          `[Tardía] ${user?.displayName || "Empleado"} - ${lateMinutes} min tarde`,
          `${user?.displayName || "Empleado"} marcó entrada ${lateMinutes} minutos tarde el ${businessDate}.\nHora programada: ${scheduledStartAt?.toLocaleTimeString("es-CR") || "N/A"}\nHora de entrada: ${now.toLocaleTimeString("es-CR")}`
        );
      }
      
      broadcast("hr_punch_update", { employeeId, type: "clock_in" });
      res.json(punch);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- Time Punches: Clock-out --
  app.post("/api/hr/clock-out", requirePermission("HR_CLOCK_IN_OUT_ALLOW"), async (req, res) => {
    try {
      const employeeId = req.session.userId!;
      
      const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);
      
      const settings = await storage.getHrSettings(req.db);
      const now = new Date();

      if (!openPunch) {
        await storage.createAuditEvent({
          actorType: "USER", actorUserId: employeeId,
          action: "CLOCK_OUT_BLOCKED_NO_ENTRY", entityType: "HR_PUNCH", entityId: 0,
          metadata: { note: "Attempted clock-out without prior clock-in (HR)" },
        });
        return res.status(400).json({ message: "No puede marcar salida si no ha marcado entrada primero." });
      }

      const elapsedMs = now.getTime() - new Date(openPunch.clockInAt).getTime();
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      if (elapsedMinutes < 60) {
        return res.status(400).json({ message: "Debe esperar al menos 1 hora desde la entrada para marcar salida." });
      }
      
      const workedMs = now.getTime() - new Date(openPunch.clockInAt).getTime();
      const workedMinutes = Math.floor(workedMs / 60000);
      
      const dailyThresholdMinutes = settings ? Number(settings.overtimeDailyThresholdHours) * 60 : 480;
      const overtimeMinutesDaily = Math.max(0, workedMinutes - dailyThresholdMinutes);
      
      const updatedPunch = await storage.updateTimePunch(openPunch.id, {
        clockOutAt: now,
        clockOutType: "MANUAL",
        workedMinutes,
        overtimeMinutesDaily,
        clockoutGeoLat: null,
        clockoutGeoLng: null,
        clockoutGeoAccuracyM: null,
        clockoutGeoVerified: false,
      }, req.db);
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: employeeId,
        action: "CLOCK_OUT",
        entityType: "HR_PUNCH",
        entityId: openPunch.id,
        metadata: { workedMinutes, overtimeMinutesDaily, geoVerified: false },
      });
      
      broadcast("hr_punch_update", { employeeId, type: "clock_out" });
      res.json(updatedPunch);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- Manager geo override clock-in/out --
  app.post("/api/hr/override-clock", requirePermission("GEO_OVERRIDE"), async (req, res) => {
    try {
      const { employeeId, action, reason } = req.body;
      if (!employeeId || !action) return res.status(400).json({ message: "employeeId and action required" });
      
      const now = new Date();
      const businessDate = await getBusinessDate(req.tenantSchema);
      const settings = await storage.getHrSettings(req.db);
      
      if (action === "clock_in") {
        const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);
        if (openPunch) return res.status(409).json({ message: "Ya tiene una entrada abierta" });
        
        const punch = await storage.createTimePunch({
          employeeId,
          businessDate,
          clockInAt: now,
          clockinGeoVerified: false,
          notes: `Override por gerente: ${reason || "Sin razón"}`,
        }, req.db);
        
        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: req.session.userId!,
          action: "GEO_OVERRIDE_CLOCK_IN",
          entityType: "HR_PUNCH",
          entityId: punch.id,
          metadata: { targetEmployeeId: employeeId, reason },
        });
        
        broadcast("hr_punch_update", { employeeId, type: "clock_in" });
        return res.json(punch);
      }
      
      if (action === "clock_out") {
        const openPunch = await storage.getOpenPunchForEmployee(employeeId, req.db);
        
        if (!openPunch) {
          await storage.createAuditEvent({
            actorType: "USER", actorUserId: req.session.userId!,
            action: "CLOCK_OUT_BLOCKED_NO_ENTRY", entityType: "HR_PUNCH", entityId: 0,
            metadata: { targetEmployeeId: employeeId, reason, note: "Override clock-out blocked - no prior clock-in" },
          });
          return res.status(400).json({ message: "No puede marcar salida si no ha marcado entrada primero." });
        }
        
        const workedMs = now.getTime() - new Date(openPunch.clockInAt).getTime();
        const workedMinutes = Math.floor(workedMs / 60000);
        
        const updatedPunch = await storage.updateTimePunch(openPunch.id, {
          clockOutAt: now,
          clockOutType: "OVERRIDE",
          workedMinutes,
          notes: `Override por gerente: ${reason || "Sin razón"}`,
          clockoutGeoVerified: false,
        }, req.db);
        
        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: req.session.userId!,
          action: "GEO_OVERRIDE_CLOCK_OUT",
          entityType: "HR_PUNCH",
          entityId: openPunch.id,
          metadata: { targetEmployeeId: employeeId, reason, workedMinutes },
        });
        
        broadcast("hr_punch_update", { employeeId, type: "clock_out" });
        return res.json(updatedPunch);
      }
      
      res.status(400).json({ message: "Invalid action. Use clock_in or clock_out" });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/hr/manual-punch", requirePermission("HR_EDIT_PUNCHES"), async (req, res) => {
    try {
      const { employeeId, date, clockInTime, clockOutTime, reason, notes } = req.body;
      if (!employeeId || !date || !clockInTime || !reason) {
        return res.status(400).json({ message: "Empleado, fecha, hora de entrada y razón son obligatorios" });
      }

      const tz = await getTenantTimezone(req.tenantSchema);
      const utcRef = new Date();
      const localRef = new Date(utcRef.toLocaleString('en-US', { timeZone: tz }));
      const tzOffsetMs = utcRef.getTime() - localRef.getTime();
      const clockInAt = new Date(new Date(`${date}T${clockInTime}:00`).getTime() + tzOffsetMs);
      if (isNaN(clockInAt.getTime())) {
        return res.status(400).json({ message: "Fecha/hora de entrada inválida" });
      }

      let clockOutAt: Date | undefined;
      let workedMinutes: number | undefined;
      if (clockOutTime) {
        clockOutAt = new Date(new Date(`${date}T${clockOutTime}:00`).getTime() + tzOffsetMs);
        if (isNaN(clockOutAt.getTime())) {
          return res.status(400).json({ message: "Hora de salida inválida" });
        }
        if (clockOutAt <= clockInAt) {
          return res.status(400).json({ message: "La hora de salida debe ser posterior a la entrada" });
        }
        workedMinutes = Math.floor((clockOutAt.getTime() - clockInAt.getTime()) / 60000);
      }

      const punch = await storage.createTimePunch({
        employeeId: Number(employeeId),
        businessDate: date,
        clockInAt,
        clockOutAt: clockOutAt || null,
        clockOutType: clockOutAt ? "MANUAL" : undefined,
        workedMinutes: workedMinutes ?? undefined,
        clockinGeoVerified: false,
        clockoutGeoVerified: clockOutAt ? false : undefined,
        notes: `Marca manual: ${reason}${notes ? ` - ${notes}` : ""}`,
      }, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "MANUAL_PUNCH_CREATE",
        entityType: "HR_PUNCH",
        entityId: punch.id,
        metadata: { targetEmployeeId: employeeId, date, clockInTime, clockOutTime, reason, notes },
      });

      broadcast("hr_punch_update", { employeeId, type: "manual" });
      res.json(punch);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- My current punch status --
  app.get("/api/hr/my-punch", requireAuth, async (req, res) => {
    const punch = await storage.getOpenPunchForEmployee(req.session.userId!, req.db);
    if (punch) {
      res.json({ clockedIn: true, clockInTime: punch.clockInAt, punchId: punch.id });
    } else {
      res.json({ clockedIn: false });
    }
  });

  // -- Time Punches queries --
  app.get("/api/hr/punches", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const { date, dateFrom, dateTo, employeeId } = req.query;
    if (employeeId) {
      const punches = await storage.getTimePunchesByEmployee(
        Number(employeeId),
        (dateFrom as string) || undefined,
        (dateTo as string) || undefined,
        req.db
      );
      return res.json(punches);
    }
    if (dateFrom && dateTo) {
      return res.json(await storage.getTimePunchesByDateRange(dateFrom as string, dateTo as string, req.db));
    }
    if (date) {
      return res.json(await storage.getTimePunchesByDate(date as string, req.db));
    }
    return res.json(await storage.getTimePunchesByDate(await getBusinessDate(req.tenantSchema), req.db));
  });

  app.get("/api/hr/punches/my", requirePermission("HR_VIEW_SELF"), async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    const punches = await storage.getTimePunchesByEmployee(
      req.session.userId!,
      (dateFrom as string) || undefined,
      (dateTo as string) || undefined,
      req.db
    );
    res.json(punches);
  });

  // -- Punch edit (manager) --
  app.patch("/api/hr/punches/:id", requirePermission("HR_EDIT_PUNCHES"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { clockInAt, clockOutAt, reason } = req.body;
      
      if (!reason) return res.status(400).json({ message: "Razón de edición obligatoria" });
      
      const existing = await storage.getTimePunch(id, req.db);
      if (!existing) return res.status(404).json({ message: "Marca no encontrada" });
      
      const updates: any = {
        editedByEmployeeId: req.session.userId!,
        editedAt: new Date(),
        editReason: reason,
      };
      
      if (clockInAt) updates.clockInAt = new Date(clockInAt);
      if (clockOutAt) {
        updates.clockOutAt = new Date(clockOutAt);
        const inTime = clockInAt ? new Date(clockInAt) : new Date(existing.clockInAt);
        const outTime = new Date(clockOutAt);
        if (outTime <= inTime) return res.status(400).json({ message: "Salida debe ser posterior a entrada" });
        updates.workedMinutes = Math.floor((outTime.getTime() - inTime.getTime()) / 60000);
      }
      
      const updated = await storage.updateTimePunch(id, updates, req.db);
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "PUNCH_EDITED",
        entityType: "HR_PUNCH",
        entityId: id,
        metadata: {
          before: { clockInAt: existing.clockInAt, clockOutAt: existing.clockOutAt },
          after: { clockInAt: updated.clockInAt, clockOutAt: updated.clockOutAt },
          reason,
        },
      });
      
      broadcast("hr_punch_update", { employeeId: existing.employeeId, type: "edited" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/hr/punches/:id", requirePermission("HR_EDIT_PUNCHES"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getTimePunch(id, req.db);
      if (!existing) return res.status(404).json({ message: "Marca no encontrada" });

      await storage.deleteTimePunch(id, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "PUNCH_DELETED",
        entityType: "HR_PUNCH",
        entityId: id,
        metadata: {
          deletedPunch: {
            employeeId: existing.employeeId,
            businessDate: existing.businessDate,
            clockInAt: existing.clockInAt,
            clockOutAt: existing.clockOutAt,
            clockOutType: existing.clockOutType,
            workedMinutes: existing.workedMinutes,
          },
        },
      });

      broadcast("hr_punch_update", { employeeId: existing.employeeId, type: "deleted" });
      res.json({ message: "Marca eliminada." });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- Extra Types + Payroll Extras CRUD --
  app.get("/api/hr/extra-types", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const types = await storage.getExtraTypes(req.db);
    res.json(types);
  });

  app.get("/api/hr/payroll-extras", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const { employeeId, dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ message: "dateFrom and dateTo required" });
    const extras = await storage.getPayrollExtrasByRange(
      dateFrom as string, dateTo as string,
      employeeId ? Number(employeeId) : undefined,
      req.db
    );
    res.json(extras);
  });

  app.post("/api/hr/payroll-extras", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const { employeeId, appliesToDate, typeCode, amount, note } = req.body;
      if (!employeeId || !appliesToDate || !typeCode || amount == null) {
        return res.status(400).json({ message: "employeeId, appliesToDate, typeCode, and amount are required" });
      }
      const types = await storage.getExtraTypes(req.db);
      const t = types.find(tt => tt.typeCode === typeCode);
      if (!t) return res.status(400).json({ message: "typeCode inválido o inactivo" });
      const needsNote = ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PRESTAMO_DEDUCCION"].includes(typeCode);
      if (needsNote && (!note || !note.trim())) {
        return res.status(400).json({ message: "La nota es obligatoria para este tipo de extra" });
      }
      const extra = await storage.createPayrollExtra({
        employeeId: Number(employeeId),
        appliesToDate,
        typeCode,
        amount: String(amount),
        note: note || null,
        createdBy: req.session.userId!,
      }, req.db);
      await storage.createAuditEvent({
        actorType: "USER", actorUserId: req.session.userId!,
        action: "PAYROLL_EXTRA_CREATE", entityType: "HR_PAYROLL_EXTRA", entityId: extra.id,
        metadata: { employeeId, appliesToDate, typeCode, amount, note },
      });
      res.json(extra);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/hr/payroll-extras/:id", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getPayrollExtraById(id, req.db);
      if (!existing || existing.isDeleted) return res.status(404).json({ message: "Extra no encontrado" });
      const { typeCode, amount, note } = req.body;
      if (typeCode) {
        const types = await storage.getExtraTypes(req.db);
        if (!types.find(t => t.typeCode === typeCode)) {
          return res.status(400).json({ message: "typeCode inválido" });
        }
        const tc = typeCode || existing.typeCode;
        const needsNote = ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PRESTAMO_DEDUCCION"].includes(tc);
        if (needsNote && (!note && !existing.note)) {
          return res.status(400).json({ message: "La nota es obligatoria para este tipo" });
        }
      }
      const updated = await storage.updatePayrollExtra(id, {
        typeCode, amount: amount != null ? String(amount) : undefined,
        note, updatedBy: req.session.userId!,
      }, req.db);
      await storage.createAuditEvent({
        actorType: "USER", actorUserId: req.session.userId!,
        action: "PAYROLL_EXTRA_UPDATE", entityType: "HR_PAYROLL_EXTRA", entityId: id,
        metadata: { before: existing, after: updated },
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/hr/payroll-extras/:id", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getPayrollExtraById(id, req.db);
      if (!existing || existing.isDeleted) return res.status(404).json({ message: "Extra no encontrado" });
      const deleted = await storage.softDeletePayrollExtra(id, req.db);
      await storage.createAuditEvent({
        actorType: "USER", actorUserId: req.session.userId!,
        action: "PAYROLL_EXTRA_DELETE", entityType: "HR_PAYROLL_EXTRA", entityId: id,
        metadata: { extra: existing },
      });
      res.json(deleted);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== HR: OVERTIME APPROVALS ====================

  app.get("/api/hr/overtime-approvals", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const { dateFrom, dateTo, employeeId } = req.query;
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ message: "dateFrom y dateTo son requeridos" });
      }
      const conditions = [
        gte(hrOvertimeApprovals.businessDate, String(dateFrom)),
        lte(hrOvertimeApprovals.businessDate, String(dateTo)),
      ];
      if (employeeId) {
        conditions.push(eq(hrOvertimeApprovals.employeeId, Number(employeeId)) as any);
      }
      const rows = await req.db.select().from(hrOvertimeApprovals).where(and(...conditions));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/hr/overtime-approvals", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const { employeeId, businessDate, status, rejectionReason, overtimeMinutes } = req.body;
      const managerId = req.session.userId!;

      if (!employeeId || !businessDate || !status || !overtimeMinutes) {
        return res.status(400).json({ message: "employeeId, businessDate, status y overtimeMinutes son requeridos" });
      }
      if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
        return res.status(400).json({ message: "status debe ser APPROVED, REJECTED o PENDING" });
      }
      if (status === "REJECTED" && !rejectionReason?.trim()) {
        return res.status(400).json({ message: "La razón de rechazo es obligatoria" });
      }

      const existing = await req.db
        .select()
        .from(hrOvertimeApprovals)
        .where(
          and(
            eq(hrOvertimeApprovals.employeeId, Number(employeeId)),
            eq(hrOvertimeApprovals.businessDate, String(businessDate))
          )
        )
        .limit(1);

      if (existing.length > 0) {
        if (status === "PENDING") {
          await req.db.delete(hrOvertimeApprovals).where(eq(hrOvertimeApprovals.id, existing[0].id));
        } else {
          await req.db
            .update(hrOvertimeApprovals)
            .set({
              status,
              approvedBy: managerId,
              approvedAt: new Date(),
              rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
              overtimeMinutes: Number(overtimeMinutes),
              updatedAt: new Date(),
            })
            .where(eq(hrOvertimeApprovals.id, existing[0].id));
        }
      } else {
        if (status !== "PENDING") {
          await req.db.insert(hrOvertimeApprovals).values({
            employeeId: Number(employeeId),
            businessDate: String(businessDate),
            overtimeMinutes: Number(overtimeMinutes),
            status,
            approvedBy: managerId,
            approvedAt: new Date(),
            rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
          });
        }
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: managerId,
        action: status === "APPROVED" ? "OVERTIME_APPROVED" : status === "REJECTED" ? "OVERTIME_REJECTED" : "OVERTIME_REVERTED",
        entityType: "hr_overtime_approval",
        entityId: Number(employeeId),
        metadata: { businessDate, overtimeMinutes, rejectionReason: rejectionReason || null },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/hr/overtime-approvals/bulk", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const { employeeId, dateFrom, dateTo, status, rejectionReason, days } = req.body;
      const managerId = req.session.userId!;

      if (!employeeId || !status || !days?.length) {
        return res.status(400).json({ message: "employeeId, status y days son requeridos" });
      }
      if (status === "REJECTED" && !rejectionReason?.trim()) {
        return res.status(400).json({ message: "La razón de rechazo es obligatoria para rechazos masivos" });
      }

      for (const day of days) {
        const existing = await req.db
          .select()
          .from(hrOvertimeApprovals)
          .where(
            and(
              eq(hrOvertimeApprovals.employeeId, Number(employeeId)),
              eq(hrOvertimeApprovals.businessDate, String(day.businessDate))
            )
          )
          .limit(1);

        const values = {
          status,
          approvedBy: managerId,
          approvedAt: new Date(),
          rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null,
          overtimeMinutes: Number(day.overtimeMinutes),
          updatedAt: new Date(),
        };

        if (existing.length > 0) {
          await req.db.update(hrOvertimeApprovals).set(values).where(eq(hrOvertimeApprovals.id, existing[0].id));
        } else {
          await req.db.insert(hrOvertimeApprovals).values({
            employeeId: Number(employeeId),
            businessDate: String(day.businessDate),
            ...values,
          });
        }
      }

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: managerId,
        action: status === "APPROVED" ? "OVERTIME_BULK_APPROVED" : "OVERTIME_BULK_REJECTED",
        entityType: "hr_overtime_approval",
        entityId: Number(employeeId),
        metadata: { dateFrom, dateTo, count: days.length, rejectionReason: rejectionReason || null },
      });

      res.json({ ok: true, count: days.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // -- Payroll Report --
  app.get("/api/hr/payroll-report", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      let dateFrom = req.query.dateFrom as string;
      let dateTo = req.query.dateTo as string;
      const weekStart = req.query.weekStart as string;

      if (weekStart) {
        dateFrom = weekStart;
        const end = new Date(weekStart + "T12:00:00");
        end.setDate(end.getDate() + 6);
        dateTo = end.toISOString().slice(0, 10);
      }

      if (!dateFrom || !dateTo) return res.status(400).json({ message: "dateFrom/dateTo or weekStart required" });

      let serviceFrom = req.query.serviceFrom as string || "";
      let serviceTo = req.query.serviceTo as string || "";
      if (!serviceFrom || !serviceTo) {
        const sfDate = new Date(dateFrom + "T12:00:00");
        sfDate.setDate(sfDate.getDate() - 14);
        serviceFrom = sfDate.toISOString().slice(0, 10);
        const stDate = new Date(serviceFrom + "T12:00:00");
        stDate.setDate(stDate.getDate() + 6);
        serviceTo = stDate.toISOString().slice(0, 10);
      } else {
        if (serviceFrom > serviceTo) return res.status(400).json({ message: "serviceFrom must be <= serviceTo" });
        const diffDays = Math.round((new Date(serviceTo + "T12:00:00").getTime() - new Date(serviceFrom + "T12:00:00").getTime()) / 86400000);
        if (diffDays > 31) return res.status(400).json({ message: "Service range cannot exceed 31 days" });
      }

      const settings = await storage.getHrSettings(req.db);
      const hrConfig: HrConfig = {
        overtimeDailyThresholdHours: settings?.overtimeDailyThresholdHours || "8",
        overtimeMultiplier: settings?.overtimeMultiplier || "1.5",
        latenessGraceMinutes: settings?.latenessGraceMinutes || 0,
        serviceChargeRate: settings?.serviceChargeRate || "0.10",
        paidStartPolicy: settings?.paidStartPolicy || "SCHEDULE_START_CAP",
        overtimeRequiresApproval: settings?.overtimeRequiresApproval !== false,
        ignoreZeroDurationPunches: settings?.ignoreZeroDurationPunches !== false,
        mergeOverlappingPunches: settings?.mergeOverlappingPunches !== false,
        breakDeductEnabled: settings?.breakDeductEnabled !== false,
        breakThresholdMinutes: settings?.breakThresholdMinutes ?? 540,
        breakDeductMinutes: settings?.breakDeductMinutes ?? 60,
        socialChargesEnabled: settings?.socialChargesEnabled === true,
        ccssEmployeeRate: settings?.ccssEmployeeRate || "10.67",
        ccssEmployerRate: settings?.ccssEmployerRate || "26.33",
        ccssIncludeService: settings?.ccssIncludeService === true,
      };

      const employees = await storage.getAllUsers(req.db);
      const activeEmployees = employees.filter(e => e.active !== false);
      const empData = activeEmployees.map(e => ({
        id: e.id,
        displayName: e.displayName || e.username,
        role: e.role,
        dailyRate: e.dailyRate,
      }));

      const [punches, scheduleDays, extras, serviceLedger, extraTypes, waiterIdsFromSalesRows, waiterIdsFromServiceRows, chargesInRange] = await Promise.all([
        storage.getPunchesForDateRange(dateFrom, dateTo, req.db),
        storage.getAllSchedulesForDateRange(dateFrom, dateTo, req.db),
        storage.getPayrollExtrasByRange(dateFrom, dateTo, undefined, req.db),
        storage.getServiceChargeLedgerByDates(serviceFrom, serviceTo, req.db),
        storage.getExtraTypes(req.db),
        req.db.execute(sql`SELECT DISTINCT responsible_waiter_id AS id FROM sales_ledger_items WHERE business_date >= ${dateFrom} AND business_date <= ${dateTo} AND responsible_waiter_id IS NOT NULL`),
        req.db.execute(sql`SELECT DISTINCT responsible_waiter_employee_id AS id FROM service_charge_ledger WHERE business_date >= ${serviceFrom} AND business_date <= ${serviceTo} AND responsible_waiter_employee_id IS NOT NULL`),
        req.db.select({ employeeId: employeeCharges.employeeId, amount: employeeCharges.amount, businessDate: employeeCharges.businessDate })
          .from(employeeCharges)
          .where(and(gte(employeeCharges.businessDate, dateFrom), lte(employeeCharges.businessDate, dateTo))),
      ]);

      const operationalWaiterIds = new Set<number>();
      for (const row of waiterIdsFromSalesRows.rows as any[]) {
        const id = Number(row.id);
        if (id > 0) operationalWaiterIds.add(id);
      }
      for (const row of waiterIdsFromServiceRows.rows as any[]) {
        const id = Number(row.id);
        if (id > 0) operationalWaiterIds.add(id);
      }

      const extraTypesKindMap: Record<string, string> = {};
      for (const t of extraTypes) extraTypesKindMap[t.typeCode] = t.kind;

      const schedulesMap: Record<string, ScheduleDay> = {};
      for (const sd of scheduleDays) {
        const weekMonday = new Date(sd.weekStartDate + "T12:00:00");
        let dayOffset = sd.dayOfWeek === 0 ? 6 : sd.dayOfWeek - 1;
        const actualDate = new Date(weekMonday);
        actualDate.setDate(actualDate.getDate() + dayOffset);
        const dateStr = actualDate.toISOString().slice(0, 10);
        if (dateStr >= dateFrom && dateStr <= dateTo) {
          schedulesMap[`${sd.employeeId}_${dateStr}`] = sd as ScheduleDay;
        }
      }

      const punchesMap: Record<string, PunchRecord[]> = {};
      for (const p of punches) {
        const key = `${p.employeeId}_${p.businessDate}`;
        if (!punchesMap[key]) punchesMap[key] = [];
        punchesMap[key].push(p as unknown as PunchRecord);
      }

      const extrasMap: Record<string, ExtraRecord[]> = {};
      for (const ex of extras) {
        const key = `${ex.employeeId}_${ex.appliesToDate}`;
        if (!extrasMap[key]) extrasMap[key] = [];
        extrasMap[key].push({
          ...ex,
          amount: String(ex.amount),
          kind: extraTypesKindMap[ex.typeCode],
        } as unknown as ExtraRecord);
      }

      const approvalRows = await db
        .select()
        .from(hrOvertimeApprovals)
        .where(
          and(
            gte(hrOvertimeApprovals.businessDate, dateFrom),
            lte(hrOvertimeApprovals.businessDate, dateTo)
          )
        );
      const overtimeApprovalsMap: Record<string, "APPROVED" | "REJECTED" | "PENDING"> = {};
      for (const row of approvalRows) {
        overtimeApprovalsMap[`${row.employeeId}_${row.businessDate}`] = row.status as "APPROVED" | "REJECTED" | "PENDING";
      }

      const emptyServicePool: Record<string, number> = {};
      const tzPayroll = await getTenantTimezone(req.tenantSchema);
      const payrollResult = computeRangePayroll({
        employees: empData,
        schedulesMap,
        punchesMap,
        extrasMap,
        servicePoolMap: emptyServicePool,
        extraTypesKindMap,
        dateFrom,
        dateTo,
        hrConfig,
        overtimeApprovalsMap,
        tz: tzPayroll,
      });

      const serviceLedgerByEmployee: Record<string, Record<number, number>> = {};
      for (const entry of serviceLedger) {
        const d = entry.businessDate;
        const empId = entry.responsibleWaiterEmployeeId || 0;
        if (!serviceLedgerByEmployee[d]) serviceLedgerByEmployee[d] = {};
        serviceLedgerByEmployee[d][empId] = (serviceLedgerByEmployee[d][empId] || 0) + Number(entry.serviceAmount);
      }

      const serviceModeParam = (req.query.serviceMode as string || "").toUpperCase();
      const serviceMode: "BOLSA" | "VENTA_MESERO" = serviceModeParam === "VENTA_MESERO" ? "VENTA_MESERO" : "BOLSA";

      const { result: serviceByEmployee, serviceUnassignedTotal, allocationModeByDate } = computeServiceForRange({
        hrConfig,
        serviceFrom,
        serviceTo,
        serviceLedgerByEmployee,
        serviceMode,
      });

      const chargesByEmployee: Record<number, number> = {};
      for (const c of chargesInRange) {
        const empId = c.employeeId;
        if (!empId) continue;
        chargesByEmployee[empId] = (chargesByEmployee[empId] || 0) + Number(c.amount);
      }

      const enrichedEmployees = payrollResult.map(emp => {
        const svcPay = serviceByEmployee[emp.employeeId] || 0;
        const grossPay = round2(emp.basePayTotal + emp.extrasNet + svcPay);
        const chargeDeductionTotal = round2(chargesByEmployee[emp.employeeId] || 0);

        let ccssBase = 0, ccssEmployee = 0, ccssEmployer = 0;
        if (hrConfig.socialChargesEnabled) {
          ccssBase = round2(emp.basePayTotal + (hrConfig.ccssIncludeService ? svcPay : 0));
          ccssEmployee = round2(ccssBase * Number(hrConfig.ccssEmployeeRate) / 100);
          ccssEmployer = round2(ccssBase * Number(hrConfig.ccssEmployerRate) / 100);
        }

        return {
          ...emp,
          servicePayTotal: svcPay,
          grossPay,
          chargeDeductionTotal,
          ccssBase,
          ccssEmployee,
          ccssEmployer,
          netPay: round2(grossPay - ccssEmployee - chargeDeductionTotal),
          employerCost: round2(grossPay + ccssEmployer),
          grandTotalPay: grossPay,
          operatedAsWaiter: operationalWaiterIds.has(emp.employeeId),
        };
      });

      const hrConfigSnapshotWarnings: string[] = [];
      if (hrConfig.ccssIncludeService && hrConfig.socialChargesEnabled) {
        hrConfigSnapshotWarnings.push("CCSS incluye servicio en base — verificar que servicePay está integrado correctamente.");
      }

      res.json({
        planillaRange: { from: dateFrom, to: dateTo },
        serviceRange: { from: serviceFrom, to: serviceTo },
        serviceMode,
        serviceDistributionPctUsed: Number(hrConfig.serviceChargeRate) * 100,
        serviceUnassignedTotal,
        allocationModeByDate,
        hrConfigSnapshot: {
          jornadaOrdinariaHorasPorDia: Number(hrConfig.overtimeDailyThresholdHours),
          multiplicadorHoraExtra: Number(hrConfig.overtimeMultiplier),
          servicePercentDefault: Number(hrConfig.serviceChargeRate),
          latenessGraceMinutes: hrConfig.latenessGraceMinutes,
          paidStartPolicy: hrConfig.paidStartPolicy,
          overtimeRequiresApproval: hrConfig.overtimeRequiresApproval,
          breakDeductEnabled: hrConfig.breakDeductEnabled,
          breakThresholdMinutes: hrConfig.breakThresholdMinutes,
          breakDeductMinutes: hrConfig.breakDeductMinutes,
          socialChargesEnabled: hrConfig.socialChargesEnabled,
          ccssEmployeeRate: Number(hrConfig.ccssEmployeeRate),
          ccssEmployerRate: Number(hrConfig.ccssEmployerRate),
          ccssIncludeService: hrConfig.ccssIncludeService,
          roundingRule: "EXACT_MINUTE",
        },
        hrConfigSnapshotWarnings,
        employees: enrichedEmployees,
      });
    } catch (err: any) {
      console.error("[payroll-report] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // -- Overtime report --
  app.get("/api/hr/overtime-report", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ message: "dateFrom and dateTo required" });
    
    const punches = await storage.getTimePunchesByDateRange(dateFrom as string, dateTo as string, req.db);
    const employees = await storage.getAllUsers(req.db);
    
    const report: Record<number, {
      employeeId: number;
      displayName: string;
      totalWorkedMinutes: number;
      totalOvertimeMinutes: number;
      totalLateDays: number;
      totalLateMinutes: number;
      punchCount: number;
    }> = {};
    
    for (const p of punches) {
      if (!report[p.employeeId]) {
        const emp = employees.find(e => e.id === p.employeeId);
        report[p.employeeId] = {
          employeeId: p.employeeId,
          displayName: emp?.displayName || `Empleado ${p.employeeId}`,
          totalWorkedMinutes: 0,
          totalOvertimeMinutes: 0,
          totalLateDays: 0,
          totalLateMinutes: 0,
          punchCount: 0,
        };
      }
      report[p.employeeId].totalWorkedMinutes += p.workedMinutes || 0;
      report[p.employeeId].totalOvertimeMinutes += p.overtimeMinutesDaily || 0;
      if (p.lateMinutes > 0) {
        report[p.employeeId].totalLateDays++;
        report[p.employeeId].totalLateMinutes += p.lateMinutes;
      }
      report[p.employeeId].punchCount++;
    }
    
    const settings = await storage.getHrSettings(req.db);
    const weeklyThreshold = settings ? Number(settings.overtimeWeeklyThresholdHours) * 60 : 2880;
    
    res.json({
      report: Object.values(report),
      weeklyThresholdMinutes: weeklyThreshold,
      overtimeMultiplier: settings ? Number(settings.overtimeMultiplier) : 1.5,
    });
  });

  // -- Service charge ledger --
  app.get("/api/hr/service-charges", requirePermission("SERVICE_VIEW_REPORTS"), async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ message: "dateFrom and dateTo required" });
    const entries = await storage.getServiceChargeLedgerByDateRange(dateFrom as string, dateTo as string, req.db);
    res.json(entries);
  });

  // -- Service charge payouts --
  app.get("/api/hr/service-payouts", requirePermission("SERVICE_VIEW_REPORTS"), async (req, res) => {
    const { periodStart, periodEnd } = req.query;
    if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
    const payouts = await storage.getServiceChargePayouts(periodStart as string, periodEnd as string, req.db);
    res.json(payouts);
  });

  app.post("/api/hr/service-payouts/generate", requirePermission("SERVICE_GENERATE_PAYOUTS"), async (req, res) => {
    try {
      const { periodStart, periodEnd } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      
      await storage.deleteServiceChargePayoutsByPeriod(periodStart, periodEnd, "PREVIEW", req.db);
      
      const entries = await storage.getServiceChargeLedgerByDateRange(periodStart, periodEnd, req.db);
      
      const byEmployee: Record<number, number> = {};
      for (const e of entries) {
        const empId = e.responsibleWaiterEmployeeId || 0;
        byEmployee[empId] = (byEmployee[empId] || 0) + Number(e.serviceAmount);
      }
      
      const payouts = [];
      for (const [empIdStr, amount] of Object.entries(byEmployee)) {
        const empId = Number(empIdStr);
        if (empId === 0 || amount <= 0) continue;
        const payout = await storage.createServiceChargePayout({
          periodStart,
          periodEnd,
          employeeId: empId,
          amount: amount.toFixed(2),
          generatedByEmployeeId: req.session.userId!,
          status: "PREVIEW",
        }, req.db);
        payouts.push(payout);
      }
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "SERVICE_PAYOUTS_GENERATED",
        entityType: "SERVICE_PAYOUT",
        metadata: { periodStart, periodEnd, count: payouts.length },
      });
      
      res.json(payouts);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/hr/service-payouts/finalize", requirePermission("SERVICE_GENERATE_PAYOUTS"), async (req, res) => {
    try {
      const { periodStart, periodEnd } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      
      const payouts = await storage.getServiceChargePayouts(periodStart, periodEnd, req.db);
      const previews = payouts.filter(p => p.status === "PREVIEW");
      
      if (previews.length === 0) return res.status(400).json({ message: "No hay liquidaciones en PREVIEW para finalizar" });
      
      const finalized = [];
      for (const p of previews) {
        const updated = await storage.updateServiceChargePayoutStatus(p.id, "FINALIZED", req.db);
        finalized.push(updated);
      }
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: req.session.userId!,
        action: "SERVICE_PAYOUTS_FINALIZED",
        entityType: "SERVICE_PAYOUT",
        metadata: { periodStart, periodEnd, count: finalized.length },
      });
      
      res.json(finalized);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // -- All active employees (for HR schedule management) --
  app.get("/api/hr/employees", requirePermission("HR_VIEW_TEAM", "HR_MANAGE_SCHEDULES"), async (req, res) => {
    const allUsers = await storage.getAllUsers(req.db);
    res.json(allUsers.filter(u => u.active).map(u => ({ id: u.id, displayName: u.displayName, role: u.role, username: u.username })));
  });

  // -- Open punches (for auto-process monitoring) --
  app.get("/api/hr/open-punches", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const openPunches = await storage.getAllOpenPunches(req.db);
    res.json(openPunches);
  });

  // ==================== HR: EMPLOYEE CHARGES ====================
  app.get("/api/hr/employee-charges", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const settled = req.query.settled === "true";
      const emp = req.query.employeeId ? Number(req.query.employeeId) : null;

      const rows = await req.db
        .select({
          id: employeeCharges.id,
          employeeId: employeeCharges.employeeId,
          employeeName: users.displayName,
          orderId: employeeCharges.orderId,
          paymentId: employeeCharges.paymentId,
          amount: employeeCharges.amount,
          description: employeeCharges.description,
          businessDate: employeeCharges.businessDate,
          isSettled: employeeCharges.isSettled,
          settledAt: employeeCharges.settledAt,
          createdAt: employeeCharges.createdAt,
        })
        .from(employeeCharges)
        .leftJoin(users, eq(users.id, employeeCharges.employeeId))
        .where(
          and(
            eq(employeeCharges.isSettled, settled),
            emp ? eq(employeeCharges.employeeId, emp) : undefined
          )
        )
        .orderBy(desc(employeeCharges.businessDate), desc(employeeCharges.id));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/hr/employee-charges/:id/settle", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    try {
      const chargeId = Number(req.params.id);
      const userId = req.session.userId!;
      const now = new Date();

      await req.db
        .update(employeeCharges)
        .set({ isSettled: true, settledAt: now, settledBy: userId })
        .where(eq(employeeCharges.id, chargeId));

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== INVENTORY MODULE ====================
  registerInventoryRoutes(app, broadcast);

  // ==================== SHORTAGES MODULE ====================
  registerShortageRoutes(app, broadcast);

  // ==================== SALES CUBE REPORTS ====================
  registerSalesCubeRoutes(app);

  // ==================== QR DAILY TOKEN ====================
  app.get("/api/qr/:tableCode/token", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
      const today = await getBusinessDateCR(req.tenantSchema);
      const token = generateQrDailyToken(tableCode, today);
      res.json({ token, date: today });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== QR SUBACCOUNTS MODULE ====================
  registerQrSubaccountRoutes(app, broadcast, { qrSubmitRateCheck, qrSubaccountRateCheck, generateQrDailyToken, getBusinessDateCR });

  // ==================== WEBSOCKET ====================
  const wss = new WebSocketServer({ noServer: true });

  const printBridges = new Map<string, WebSocket>();

  function dispatchPrintJob(job: { jobType: string; destination: string; payload: any }) {
    const msg = JSON.stringify({ type: "print_job", payload: job });
    let sent = 0;
    printBridges.forEach((ws, bridgeId) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); sent++; } catch { printBridges.delete(bridgeId); }
      } else {
        printBridges.delete(bridgeId);
      }
    });
    return sent > 0;
  }

  (app as any).dispatchPrintJob = dispatchPrintJob;

  const BRIDGE_TOKEN = process.env.PRINT_BRIDGE_TOKEN || "bridge-token-local";

  const isBridgeToken = (token: string): boolean => {
    return token === BRIDGE_TOKEN;
  };

  const wsHandshakeTracker = new Map<string, { count: number; resetAt: number }>();
  const WS_HANDSHAKE_MAX = 30;
  const WS_HANDSHAKE_WINDOW = 60000;

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of wsHandshakeTracker) {
      if (entry.resetAt <= now) wsHandshakeTracker.delete(ip);
    }
  }, 60000);

  httpServer.on("upgrade", (request, socket, head) => {
    const urlPath = (request.url || "").split("?")[0];
    if (urlPath !== "/ws") {
      socket.destroy();
      return;
    }

    const ip = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const tracker = wsHandshakeTracker.get(ip);
    if (tracker && tracker.resetAt > now) {
      if (tracker.count >= WS_HANDSHAKE_MAX) {
        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        socket.destroy();
        return;
      }
      tracker.count++;
    } else {
      wsHandshakeTracker.set(ip, { count: 1, resetAt: now + WS_HANDSHAKE_WINDOW });
    }

    const urlParams = new URLSearchParams((request.url || "").split("?")[1] || "");
    const bridgeToken = urlParams.get("bridge_token") || request.headers["x-bridge-token"] as string;
    if (bridgeToken) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, "bridge_header");
      });
      return;
    }

    const res = new ServerResponse(request);
    res.assignSocket(socket as unknown as import("net").Socket);
    const sessionMiddleware = app.get("sessionMiddleware");
    if (sessionMiddleware) {
      sessionMiddleware(request as any, res as any, () => {
        const sess = (request as any).session;
        if (!sess?.userId) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      });
    } else {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (ws, _request, clientType?: string) => {
    if (clientType === "bridge_header") {
      const headerToken = _request.headers['x-bridge-token'] as string
        || new URLSearchParams((_request.url || "").split("?")[1] || "").get("bridge_token")
        || "";
      let ok = false;
      try {
        const { rows: tenants } = await pool.query(
          `SELECT schema_name FROM public.tenants
           WHERE is_active = true ORDER BY id`
        );
        for (const t of tenants) {
          const result = await validateBridgeToken(headerToken, t.schema_name);
          if (result.valid && result.bridgeId) {
            registerBridge(headerToken, result.bridgeId, t.schema_name, ws);
            printBridges.set(result.bridgeId, ws);
            ws.on('close', () => {
              unregisterBridge(headerToken);
              printBridges.forEach((v, k) => { if (v === ws) printBridges.delete(k); });
            });
            ws.on('error', () => {
              printBridges.forEach((v, k) => { if (v === ws) printBridges.delete(k); });
            });
            ws.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'PING' || msg.type === 'ping')
                  ws.send(JSON.stringify({ type: 'PONG' }));
                if (msg.type === 'PRINT_ACK')
                  console.log(`[print] ACK bridge=${result.bridgeId} printer=${msg.printerId} ok=${msg.success}`);
                if (msg.type === "print_bridge_register") {
                  const bridgeId = msg.payload?.bridgeId || "unknown";
                  printBridges.set(bridgeId, ws);
                  console.log(`[PrintBridge] Registrado: ${bridgeId}`);
                  ws.send(JSON.stringify({ type: "pong" }));
                }
              } catch {}
            });
            ws.send(JSON.stringify({
              type: 'CONNECTED', bridgeId: result.bridgeId
            }));
            ok = true;
            break;
          }
        }
        if (!ok) { ws.close(1008, 'Token inválido'); return; }
      } catch (err: any) {
        console.error('[ws] Error auth bridge header:', err.message);
        ws.close(1011, 'Error interno');
      }
      return;
    }

    wsClients.add(ws);

    let bridgeAuthResolved = false;
    const authTimeout = setTimeout(() => {
      bridgeAuthResolved = true;
    }, 5000);

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!bridgeAuthResolved && msg.type === 'AUTH') {
          clearTimeout(authTimeout);
          bridgeAuthResolved = true;
          const authenticated = await authenticateBridgeByMessage(msg.token, ws);
          if (!authenticated) {
            ws.send(JSON.stringify({
              type: 'AUTH_ERROR', message: 'Token inválido'
            }));
            ws.close(1008);
          }
          return;
        }

        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }
        if (msg.type === 'PRINT_ACK') {
          console.log(`[print] ACK printer=${msg.printerId} ok=${msg.success}`);
          return;
        }

        if (msg.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        }
        if (msg.type === "print_bridge_register") {
          const bridgeId = msg.payload?.bridgeId || "unknown";
          printBridges.set(bridgeId, ws);
          console.log(`[PrintBridge] Registrado: ${bridgeId}`);
          ws.send(JSON.stringify({ type: "pong" }));
        }
        if (msg.type === "dispatch_register") {
          const orderId = msg.payload?.orderId;
          if (orderId) {
            registerDispatchSession(orderId, ws);
            ws.send(JSON.stringify({ type: "dispatch_registered", payload: { orderId } }));
          }
        }
      } catch {}
    });
    ws.on("close", () => {
      wsClients.delete(ws);
      printBridges.forEach((v, k) => { if (v === ws) printBridges.delete(k); });
    });
    ws.on("error", () => {
      wsClients.delete(ws);
      printBridges.forEach((v, k) => { if (v === ws) printBridges.delete(k); });
    });
  });

  app.get("/api/admin/print-bridge/status", requireRole("MANAGER"), (req, res) => {
    res.json({ available: isBridgeConnected(req.tenantSchema) });
  });

  app.post("/api/admin/print-bridge/test", requireRole("MANAGER"), async (_req, res) => {
    const dispatch = (app as any).dispatchPrintJob;
    if (typeof dispatch !== "function") {
      return res.status(503).json({ ok: false, error: "dispatchPrintJob no disponible" });
    }
    const { buildTestPageBuffer } = await import("./escpos");
    const buffer = buildTestPageBuffer("bridge-test");
    const sent = dispatch({
      jobType: "raw",
      destination: "caja",
      payload: { raw: buffer.toString("base64") }
    });
    if (!sent) {
      return res.status(503).json({ ok: false, error: "No hay bridge conectado" });
    }
    return res.json({ ok: true });
  });

  app.get("/api/admin/print-bridges", requireRole("MANAGER"), async (req, res) => {
    try {
      const rows = await req.db.select({
        id: printBridgesTable.id,
        bridgeId: printBridgesTable.bridgeId,
        displayName: printBridgesTable.displayName,
        isActive: printBridgesTable.isActive,
        lastSeenAt: printBridgesTable.lastSeenAt,
        createdAt: printBridgesTable.createdAt,
      }).from(printBridgesTable).orderBy(printBridgesTable.createdAt);

      const live = new Set(
        getConnectedBridgesForTenant(req.tenantSchema).map(c => c.bridgeId)
      );
      res.json(rows.map(b => ({ ...b, isConnected: live.has(b.bridgeId) })));
    } catch (err: any) {
      console.error("[bridges] GET error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/print-bridges", requireRole("MANAGER"), async (req, res) => {
    try {
      const { displayName } = req.body;
      if (!displayName?.trim())
        return res.status(400).json({ error: 'displayName requerido' });
      const token = `rms-${crypto.randomBytes(20).toString('hex')}`;
      const bridgeId = `bridge-${crypto.randomBytes(4).toString('hex')}`;
      const [created] = await req.db
        .insert(printBridgesTable)
        .values({ bridgeId, displayName: displayName.trim(), token, isActive: true })
        .returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error("[bridges] POST error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/print-bridges/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const updates: any = {};
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      const [updated] = await req.db
        .update(printBridgesTable).set(updates)
        .where(eq(printBridgesTable.id, parseInt(req.params.id as string)))
        .returning();
      const { token: _t, ...safe } = updated;
      res.json(safe);
    } catch (err: any) {
      console.error("[bridges] PATCH error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/print-bridges/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [bridge] = await req.db.select().from(printBridgesTable).where(eq(printBridgesTable.id, id));
      if (!bridge) return res.status(404).json({ error: "Bridge no encontrado" });

      const connectedIds = new Set(
        getConnectedBridgesForTenant(req.tenantSchema).map(c => c.bridgeId)
      );
      if (connectedIds.has(bridge.bridgeId)) {
        return res.status(400).json({ error: "No se puede eliminar un bridge conectado. Desconéctelo primero." });
      }

      await req.db.update(printersTable).set({ bridgeId: null }).where(eq(printersTable.bridgeId, bridge.bridgeId));
      await req.db.delete(printBridgesTable).where(eq(printBridgesTable.id, id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[bridges] DELETE error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/print-bridges/:id/regenerate-token", requireRole("MANAGER"), async (req, res) => {
    try {
      const token = `rms-${crypto.randomBytes(20).toString('hex')}`;
      await req.db.update(printBridgesTable).set({ token })
        .where(eq(printBridgesTable.id, parseInt(req.params.id as string)));
      res.json({ token });
    } catch (err: any) {
      console.error("[bridges] REGEN error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/printers/:id/test", requireRole("MANAGER"), async (req, res) => {
    try {
      const testPayload = Buffer.concat([
        Buffer.from('\x1B\x40'),
        Buffer.from('\x1B\x61\x01'),
        Buffer.from('\x1B\x21\x30'),
        Buffer.from('RMSCore\n'),
        Buffer.from('\x1B\x21\x00'),
        Buffer.from('Prueba de impresion\n'),
        Buffer.from(new Date().toLocaleString('es-CR') + '\n\n\n'),
        Buffer.from('\x1D\x56\x41\x10'),
      ]).toString('base64');

      const result = await dispatchPrintJobViaBridge(
        req.tenantSchema,
        parseInt(req.params.id as string),
        testPayload,
        'test'
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/fix-loyverse-timestamps", requireRole("MANAGER"), async (req, res) => {
    try {
      const result1 = await req.db.execute(sql`
        UPDATE sales_ledger_items 
        SET created_at = created_at + INTERVAL '12 hours',
            paid_at = paid_at + INTERVAL '12 hours',
            business_date = (((created_at + INTERVAL '12 hours') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date::text
        WHERE origin = 'LOYVERSE_POS'
      `);
      const result2 = await req.db.execute(sql`
        UPDATE payments 
        SET paid_at = paid_at + INTERVAL '12 hours'
        WHERE order_id IN (SELECT DISTINCT order_id FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS')
        AND paid_at IS NOT NULL
      `);
      const result3 = await req.db.execute(sql`
        UPDATE sales_ledger_items
        SET category_name_snapshot = regexp_replace(category_name_snapshot, '^\d+-', '')
        WHERE origin = 'LOYVERSE_POS' AND category_name_snapshot ~ '^\d+-'
      `);
      res.json({ 
        ok: true, 
        ledgerTimestampRows: result1.rowCount, 
        paymentRows: result2.rowCount,
        categoryCleanupRows: result3.rowCount
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== RESERVATIONS MODULE ====================

  async function generateReservationCode(dbInstance: typeof db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RES-${year}-`;
    const result = await dbInstance.select({ code: reservations.reservationCode })
      .from(reservations)
      .where(sql`reservation_code LIKE ${prefix + '%'}`)
      .orderBy(desc(reservations.id))
      .limit(1);
    const lastNum = result.length > 0 ? parseInt(result[0].code.replace(prefix, ''), 10) : 0;
    return `${prefix}${String((lastNum || 0) + 1).padStart(4, '0')}`;
  }

  async function getDurationForPartySize(partySize: number, dbInstance: typeof db): Promise<number> {
    const configs = await dbInstance.select().from(reservationDurationConfig).orderBy(asc(reservationDurationConfig.minPartySize));
    for (const c of configs) {
      if (partySize >= c.minPartySize && partySize <= c.maxPartySize) return c.durationMinutes;
    }
    return 90;
  }

  function timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function addMinutesToTime(t: string, mins: number): number {
    return timeToMinutes(t) + mins;
  }

  async function checkReservationConflict(tableIdOrIds: number | number[], date: string, time: string, durationMinutes: number, dbInstance: typeof db, excludeId?: number) {
    const tableIdsToCheck = Array.isArray(tableIdOrIds) ? tableIdOrIds : [tableIdOrIds];
    const conditions = [
      eq(reservations.reservedDate, date),
      inArray(reservations.status, ['CONFIRMED', 'SEATED']),
    ];
    if (excludeId) conditions.push(ne(reservations.id, excludeId));
    const existing = await dbInstance.select().from(reservations).where(and(...conditions));
    const newStart = timeToMinutes(time);
    const newEnd = addMinutesToTime(time, durationMinutes);
    for (const r of existing) {
      const rTableIds = r.tableIds || (r.tableId ? [r.tableId] : []);
      const overlaps = tableIdsToCheck.some(tid => rTableIds.includes(tid));
      if (!overlaps) continue;
      const rStart = timeToMinutes(r.reservedTime);
      const rEnd = addMinutesToTime(r.reservedTime, r.durationMinutes);
      if (newStart < rEnd && newEnd > rStart) {
        return { conflict: true, with: r };
      }
    }
    return { conflict: false, with: null };
  }

  function getReservationTableIds(r: { tableIds: number[] | null; tableId: number | null }): number[] {
    return r.tableIds || (r.tableId ? [r.tableId] : []);
  }

  function reservationCoversTable(r: { tableIds: number[] | null; tableId: number | null }, tableId: number): boolean {
    return getReservationTableIds(r).includes(tableId);
  }

  function findTableBlock(freeTables: { id: number; capacity: number }[], partySize: number): number[] {
    const singleTable = freeTables.find(t => t.capacity >= partySize);
    if (singleTable) return [singleTable.id];

    const sorted = [...freeTables].sort((a, b) => b.capacity - a.capacity);
    const block: number[] = [];
    let remaining = partySize;
    for (const table of sorted) {
      block.push(table.id);
      remaining -= table.capacity;
      if (remaining <= 0) break;
    }
    return remaining <= 0 ? block : [];
  }

  async function sendReservationEmail(email: string, reservation: { reservationCode: string; guestName: string; reservedDate: string; reservedTime: string; partySize: number; notes: string | null }, tenantSchema?: string, dbInstance?: typeof db) {
    try {
      const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      if (!smtpHost || !smtpUser || !smtpPass) return;
      const nodemailer = await import("nodemailer");
      const transporter = (nodemailer.default || nodemailer).createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPass },
      });
      const config = await storage.getBusinessConfig(tenantSchema);
      const businessName = config?.businessName || "Restaurante";
      await transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: email,
        subject: `Reserva recibida - ${reservation.reservationCode} | ${businessName}`,
        text: `Hola ${reservation.guestName},\n\nTu reserva ha sido recibida.\n\nCodigo: ${reservation.reservationCode}\nFecha: ${reservation.reservedDate}\nHora: ${reservation.reservedTime}\nPersonas: ${reservation.partySize}\n${reservation.notes ? `Notas: ${reservation.notes}\n` : ''}\nEl restaurante confirmara tu reserva pronto.\n\nGracias,\n${businessName}`,
      });
      const d = dbInstance || db;
      await d.update(reservations).set({ confirmationSentAt: new Date() }).where(eq(reservations.reservationCode, reservation.reservationCode));
    } catch (err) {
      console.error("[Reservations] Failed to send confirmation email:", err);
    }
  }

  // GET /api/reservations - List reservations by date
  app.get("/api/reservations", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const { date, tableId, status } = req.query;
      if (!date) return res.status(400).json({ message: "date es requerido" });
      const conditions: any[] = [eq(reservations.reservedDate, date as string)];
      if (status) conditions.push(eq(reservations.status, status as string));

      let rows = await req.db.select().from(reservations)
        .where(and(...conditions))
        .orderBy(asc(reservations.reservedTime));

      if (tableId) {
        const tid = parseInt(tableId as string);
        rows = rows.filter(r => reservationCoversTable(r, tid));
      }

      const allTables = await storage.getAllTables(false, req.db);
      const tableMap = new Map(allTables.map(t => [t.id, { id: t.id, tableName: t.tableName, tableCode: t.tableCode, capacity: t.capacity }]));

      const result = rows.map(r => {
        const tIds = getReservationTableIds(r);
        const tables = tIds.map(tid => tableMap.get(tid)).filter(Boolean);
        return {
          ...r,
          table: tables.length > 0 ? tables[0] : null,
          tables,
        };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/reservations/availability
  app.get("/api/reservations/availability", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const { date, partySize } = req.query;
      if (!date || !partySize) return res.status(400).json({ message: "date y partySize son requeridos" });
      const ps = parseInt(partySize as string);
      const allTables = await storage.getAllTables(false, req.db);
      const activeTables = allTables.filter(t => t.active);

      const dayReservations = await req.db.select().from(reservations)
        .where(and(
          eq(reservations.reservedDate, date as string),
          inArray(reservations.status, ['CONFIRMED', 'SEATED']),
        ));

      const result = activeTables.map(t => {
        const tableReservations = dayReservations.filter(r => reservationCoversTable(r, t.id));
        return {
          id: t.id,
          tableName: t.tableName,
          tableCode: t.tableCode,
          capacity: t.capacity,
          reservations: tableReservations.map(r => ({
            id: r.id,
            guestName: r.guestName,
            reservedTime: r.reservedTime,
            durationMinutes: r.durationMinutes,
            endTime: (() => {
              const mins = timeToMinutes(r.reservedTime) + r.durationMinutes;
              return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
            })(),
          })),
        };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/reservations/:id
  app.get("/api/reservations/:id", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const rows = await req.db.select().from(reservations).where(eq(reservations.id, id));
      if (rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/reservations - Create (authenticated, status = CONFIRMED)
  app.post("/api/reservations", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const { guestName, guestPhone, guestEmail, partySize, reservedDate, reservedTime, tableId, tableIds: reqTableIds, notes, durationMinutes } = req.body;
      if (!guestName || !guestPhone || !partySize || !reservedDate || !reservedTime) {
        return res.status(400).json({ message: "Faltan campos requeridos" });
      }
      const duration = durationMinutes || await getDurationForPartySize(partySize, req.db);
      const assignedTableIds: number[] = reqTableIds || (tableId ? [tableId] : []);

      if (assignedTableIds.length > 0) {
        const conflict = await checkReservationConflict(assignedTableIds, reservedDate, reservedTime, duration, req.db);
        if (conflict.conflict) {
          return res.status(409).json({
            message: `Conflicto con reserva existente de ${conflict.with!.guestName} (${conflict.with!.reservedTime})`,
            conflictWith: conflict.with,
          });
        }
      }

      const code = await generateReservationCode(req.db);
      const [created] = await req.db.insert(reservations).values({
        reservationCode: code,
        guestName,
        guestPhone,
        guestEmail: guestEmail || null,
        partySize,
        reservedDate,
        reservedTime,
        durationMinutes: duration,
        tableId: assignedTableIds.length > 0 ? assignedTableIds[0] : null,
        tableIds: assignedTableIds.length > 0 ? assignedTableIds : null,
        status: 'CONFIRMED',
        notes: notes || null,
        createdBy: req.session.userId || null,
      }).returning();

      broadcast("reservation_updated", { reservationId: created.id, tableIds: getReservationTableIds(created), status: created.status });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/reservations/:id - Update
  app.patch("/api/reservations/:id", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const rows = await req.db.select().from(reservations).where(eq(reservations.id, id));
      if (rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
      const existing = rows[0];
      if (!['PENDING', 'CONFIRMED'].includes(existing.status)) {
        return res.status(400).json({ message: "Solo se pueden editar reservas PENDING o CONFIRMED" });
      }

      const { guestName, guestPhone, guestEmail, partySize, reservedDate, reservedTime, tableId, tableIds: reqTableIds, notes, durationMinutes } = req.body;
      const newTableIds: number[] = reqTableIds !== undefined ? (reqTableIds || []) : (tableId !== undefined ? (tableId ? [tableId] : []) : getReservationTableIds(existing));
      const newDate = reservedDate || existing.reservedDate;
      const newTime = reservedTime || existing.reservedTime;
      const newDuration = durationMinutes || existing.durationMinutes;

      const existingTableIds = getReservationTableIds(existing);
      const tablesChanged = JSON.stringify(newTableIds.sort()) !== JSON.stringify(existingTableIds.sort());
      if (newTableIds.length > 0 && (tablesChanged || newDate !== existing.reservedDate || newTime !== existing.reservedTime)) {
        const conflict = await checkReservationConflict(newTableIds, newDate, newTime, newDuration, req.db, id);
        if (conflict.conflict) {
          return res.status(409).json({
            message: `Conflicto con reserva existente de ${conflict.with!.guestName} (${conflict.with!.reservedTime})`,
            conflictWith: conflict.with,
          });
        }
      }

      const updates: any = { updatedAt: new Date() };
      if (guestName !== undefined) updates.guestName = guestName;
      if (guestPhone !== undefined) updates.guestPhone = guestPhone;
      if (guestEmail !== undefined) updates.guestEmail = guestEmail;
      if (partySize !== undefined) updates.partySize = partySize;
      if (reservedDate !== undefined) updates.reservedDate = reservedDate;
      if (reservedTime !== undefined) updates.reservedTime = reservedTime;
      if (reqTableIds !== undefined || tableId !== undefined) {
        updates.tableId = newTableIds.length > 0 ? newTableIds[0] : null;
        updates.tableIds = newTableIds.length > 0 ? newTableIds : null;
      }
      if (notes !== undefined) updates.notes = notes;
      if (durationMinutes !== undefined) updates.durationMinutes = durationMinutes;

      const [updated] = await req.db.update(reservations).set(updates).where(eq(reservations.id, id)).returning();
      broadcast("reservation_updated", { reservationId: updated.id, tableIds: getReservationTableIds(updated), status: updated.status });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/reservations/:id/status - Status transitions
  app.patch("/api/reservations/:id/status", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { status, reason } = req.body;
      const rows = await req.db.select().from(reservations).where(eq(reservations.id, id));
      if (rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
      const existing = rows[0];

      const validTransitions: Record<string, string[]> = {
        PENDING: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['SEATED', 'NO_SHOW', 'CANCELLED'],
        WAITING: ['CONFIRMED', 'CANCELLED'],
      };
      const allowed = validTransitions[existing.status];
      if (!allowed || !allowed.includes(status)) {
        return res.status(400).json({ message: `Transicion invalida: ${existing.status} -> ${status}` });
      }

      const updates: any = { status, updatedAt: new Date() };
      if (status === 'SEATED') updates.seatedAt = new Date();
      if (status === 'CANCELLED') {
        updates.cancelledAt = new Date();
        updates.cancellationReason = reason || null;
      }

      const [updated] = await req.db.update(reservations).set(updates).where(eq(reservations.id, id)).returning();
      broadcast("reservation_updated", { reservationId: updated.id, tableIds: getReservationTableIds(updated), status: updated.status });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/reservations/duration-config
  app.get("/api/reservations/duration-config", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const configs = await req.db.select().from(reservationDurationConfig).orderBy(asc(reservationDurationConfig.minPartySize));
    res.json(configs);
  });

  // PUT /api/reservations/duration-config
  app.put("/api/reservations/duration-config", requireRole("MANAGER"), async (req, res) => {
    try {
      const { configs } = req.body;
      if (!Array.isArray(configs)) return res.status(400).json({ message: "configs debe ser un array" });
      await req.db.delete(reservationDurationConfig);
      for (const c of configs) {
        await req.db.insert(reservationDurationConfig).values({
          minPartySize: c.minPartySize,
          maxPartySize: c.maxPartySize,
          durationMinutes: c.durationMinutes,
        });
      }
      const result = await req.db.select().from(reservationDurationConfig).orderBy(asc(reservationDurationConfig.minPartySize));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/reservations/settings
  app.get("/api/reservations/settings", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const rows = await req.db.select().from(reservationSettings);
    if (rows.length === 0) {
      const [created] = await req.db.insert(reservationSettings).values({}).returning();
      return res.json(created);
    }
    res.json(rows[0]);
  });

  // PUT /api/reservations/settings
  app.put("/api/reservations/settings", requireRole("MANAGER"), async (req, res) => {
    try {
      const { openTime, closeTime, slotIntervalMinutes, maxOccupancyPercent, turnoverBufferMinutes, maxPartySize, occupancyThresholdPercent, enabled } = req.body;
      const rows = await req.db.select().from(reservationSettings);
      if (rows.length === 0) {
        const [created] = await req.db.insert(reservationSettings).values({
          openTime: openTime || "11:00",
          closeTime: closeTime || "22:00",
          slotIntervalMinutes: slotIntervalMinutes || 30,
          maxOccupancyPercent: maxOccupancyPercent !== undefined ? maxOccupancyPercent : 50,
          turnoverBufferMinutes: turnoverBufferMinutes !== undefined ? turnoverBufferMinutes : 15,
          maxPartySize: maxPartySize !== undefined ? maxPartySize : 20,
          occupancyThresholdPercent: occupancyThresholdPercent !== undefined ? occupancyThresholdPercent : 10,
          enabled: enabled !== undefined ? enabled : true,
        }).returning();
        return res.json(created);
      }
      const [updated] = await req.db.update(reservationSettings)
        .set({
          openTime: openTime || rows[0].openTime,
          closeTime: closeTime || rows[0].closeTime,
          slotIntervalMinutes: slotIntervalMinutes !== undefined ? slotIntervalMinutes : rows[0].slotIntervalMinutes,
          maxOccupancyPercent: maxOccupancyPercent !== undefined ? maxOccupancyPercent : rows[0].maxOccupancyPercent,
          turnoverBufferMinutes: turnoverBufferMinutes !== undefined ? turnoverBufferMinutes : rows[0].turnoverBufferMinutes,
          maxPartySize: maxPartySize !== undefined ? maxPartySize : (rows[0].maxPartySize ?? 20),
          occupancyThresholdPercent: occupancyThresholdPercent !== undefined ? occupancyThresholdPercent : (rows[0].occupancyThresholdPercent ?? 10),
          enabled: enabled !== undefined ? enabled : rows[0].enabled,
        })
        .where(eq(reservationSettings.id, rows[0].id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== PUBLIC MENU ====================

  app.get("/api/public/menu", async (req, res) => {
    if (!checkPublicRateLimit(req, res)) return;
    try {
      res.set("Cache-Control", "public, max-age=60");
      const allCategories = await req.db
        .select()
        .from(categories)
        .where(eq(categories.active, true))
        .orderBy(categories.sortOrder, categories.name);

      const topCategories = allCategories.filter(c => c.categoryCode.startsWith("TOP-"));
      const subcategories = allCategories.filter(c => c.parentCategoryCode && !c.categoryCode.startsWith("TOP-"));

      const allProducts = await req.db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          categoryId: products.categoryId,
          imageUrl: products.imageUrl,
          availablePortions: products.availablePortions,
        })
        .from(products)
        .where(
          and(
            eq(products.active, true),
            eq(products.visibleQr, true),
          )
        )
        .orderBy(products.name);

      res.json({
        topCategories: topCategories.map(c => ({
          id: c.id,
          categoryCode: c.categoryCode,
          name: c.name,
          sortOrder: c.sortOrder,
          foodType: c.foodType,
        })),
        subcategories: subcategories.map(c => ({
          id: c.id,
          categoryCode: c.categoryCode,
          name: c.name,
          parentCategoryCode: c.parentCategoryCode,
          sortOrder: c.sortOrder,
        })),
        products: allProducts,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/products/:id/image
  app.post("/api/admin/products/:id/image", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const product = await storage.getProduct(id, req.db);
      if (!product) return res.status(404).json({ message: "Producto no encontrado" });

      const { imageData, mimeType } = req.body;
      if (!imageData || !mimeType) {
        return res.status(400).json({ message: "imageData y mimeType son requeridos" });
      }

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(mimeType)) {
        return res.status(400).json({ message: "Formato no soportado. Use JPG, PNG o WebP" });
      }

      const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
      const fileName = `product-${id}.${ext}`;

      const fs = await import("fs");
      const path = await import("path");

      const dirs = [
        path.resolve(process.cwd(), "client", "public", "product-images"),
        path.resolve(process.cwd(), "dist", "public", "product-images"),
      ];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        const oldFiles = fs.readdirSync(dir).filter((f: string) => f.startsWith(`product-${id}.`));
        for (const f of oldFiles) {
          fs.unlinkSync(path.join(dir, f));
        }
      }

      const buffer = Buffer.from(imageData, "base64");
      if (buffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ message: "La imagen no debe exceder 2MB" });
      }

      for (const dir of dirs) {
        fs.writeFileSync(path.join(dir, fileName), buffer);
      }

      const imageUrl = `/product-images/${fileName}`;
      await storage.updateProduct(id, { imageUrl }, req.db);

      res.json({ imageUrl });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/admin/products/:id/image
  app.delete("/api/admin/products/:id/image", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const product = await storage.getProduct(id, req.db);
      if (!product) return res.status(404).json({ message: "Producto no encontrado" });

      if (product.imageUrl) {
        const fs = await import("fs");
        const path = await import("path");
        const bases = [
          path.resolve(process.cwd(), "client", "public"),
          path.resolve(process.cwd(), "dist", "public"),
        ];
        for (const base of bases) {
          const filePath = path.resolve(base, product.imageUrl.replace(/^\//, ""));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }

      await storage.updateProduct(id, { imageUrl: null }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/public/reservations/settings (public - limited info)
  app.get("/api/public/reservations/settings", async (req, res) => {
    const rows = await req.db.select().from(reservationSettings);
    const settings = rows.length > 0 ? rows[0] : { openTime: "11:00", closeTime: "22:00", slotIntervalMinutes: 30, enabled: true, maxPartySize: 20 };
    res.json({ openTime: settings.openTime, closeTime: settings.closeTime, slotIntervalMinutes: settings.slotIntervalMinutes, enabled: settings.enabled, maxPartySize: settings.maxPartySize ?? 20 });
  });

  // ==================== PUBLIC RESERVATIONS ====================

  // POST /api/public/reservations
  app.post("/api/public/reservations", async (req, res) => {
    try {
      if (!reservationRateCheck(req, res)) return;

      const { guestName, guestPhone, guestEmail, partySize, reservedDate, reservedTime, notes } = req.body;
      if (!guestName || !guestPhone || !partySize || !reservedDate || !reservedTime) {
        return res.status(400).json({ message: "Faltan campos requeridos" });
      }
      const duration = await getDurationForPartySize(partySize, req.db);

      const settingsRows = await req.db.select().from(reservationSettings);
      const settings = settingsRows.length > 0 ? settingsRows[0] : { turnoverBufferMinutes: 15, maxOccupancyPercent: 50, occupancyThresholdPercent: 10, enabled: true };
      const buffer = settings.turnoverBufferMinutes;

      if (!settings.enabled) {
        return res.status(400).json({ message: "El sistema de reservaciones no está disponible." });
      }

      const allTables = await storage.getAllTables(false, req.db);
      const activeTables = allTables.filter(t => t.active).sort((a, b) => a.capacity - b.capacity);
      const totalSeats = activeTables.reduce((sum, t) => sum + t.capacity, 0);
      const maxReservableSeats = Math.max(1, Math.floor(totalSeats * settings.maxOccupancyPercent / 100));
      const thresholdSeats = Math.floor(totalSeats * (settings.occupancyThresholdPercent ?? 10) / 100);

      const dayReservations = await req.db.select().from(reservations)
        .where(and(
          eq(reservations.reservedDate, reservedDate),
          inArray(reservations.status, ['PENDING', 'CONFIRMED', 'SEATED']),
        ));

      const slotStart = timeToMinutes(reservedTime);
      const slotEnd = slotStart + duration;

      const occupiedTableIds = new Set<number>();
      for (const r of dayReservations) {
        const rStart = timeToMinutes(r.reservedTime);
        const rEnd = rStart + r.durationMinutes + buffer;
        if (slotStart < rEnd && slotEnd > rStart) {
          for (const tid of getReservationTableIds(r)) {
            occupiedTableIds.add(tid);
          }
        }
      }

      const freeTables = activeTables.filter(t => !occupiedTableIds.has(t.id));
      const reservedPersons = dayReservations
        .filter(r => {
          const rStart = timeToMinutes(r.reservedTime);
          const rEnd = rStart + r.durationMinutes + buffer;
          return slotStart < rEnd && slotEnd > rStart;
        })
        .reduce((sum, r) => sum + r.partySize, 0);

      if (reservedPersons + partySize > maxReservableSeats + thresholdSeats) {
        return res.status(409).json({ message: "No hay disponibilidad para ese horario. Por favor intente otro horario." });
      }

      const assignedTableIds = findTableBlock(freeTables, partySize);

      if (assignedTableIds.length === 0) {
        return res.status(409).json({ message: "No hay mesas disponibles para ese horario. Por favor intente otro horario." });
      }

      const code = await generateReservationCode(req.db);
      const [created] = await req.db.insert(reservations).values({
        reservationCode: code,
        guestName,
        guestPhone,
        guestEmail: guestEmail || null,
        partySize,
        reservedDate,
        reservedTime,
        durationMinutes: duration,
        tableId: assignedTableIds[0],
        tableIds: assignedTableIds,
        status: 'PENDING',
        notes: notes || null,
        createdBy: null,
      }).returning();

      broadcast("reservation_updated", { reservationId: created.id, tableIds: assignedTableIds, status: created.status });

      if (guestEmail) {
        sendReservationEmail(guestEmail, {
          reservationCode: code,
          guestName,
          reservedDate,
          reservedTime,
          partySize,
          notes: notes || null,
        }, req.tenantSchema, req.db);
      }

      res.status(201).json({ reservationCode: code, message: "Reserva recibida exitosamente" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/public/reservations/available-times
  app.get("/api/public/reservations/available-times", async (req, res) => {
    try {
      const { date, partySize } = req.query;
      if (!date || !partySize) return res.status(400).json({ message: "date y partySize son requeridos" });
      const ps = parseInt(partySize as string);

      const settingsRows = await req.db.select().from(reservationSettings);
      const settings = settingsRows.length > 0 ? settingsRows[0] : {
        openTime: "11:00", closeTime: "22:00", slotIntervalMinutes: 30,
        maxOccupancyPercent: 50, turnoverBufferMinutes: 15, occupancyThresholdPercent: 10, enabled: true
      };

      if (!settings.enabled) {
        return res.json([]);
      }

      const allTables = await storage.getAllTables(false, req.db);
      const activeTables = allTables.filter(t => t.active).sort((a, b) => a.capacity - b.capacity);
      const totalSeats = activeTables.reduce((sum, t) => sum + t.capacity, 0);

      if (totalSeats === 0) {
        return res.json([]);
      }

      const maxReservableSeats = Math.max(1, Math.floor(totalSeats * settings.maxOccupancyPercent / 100));
      const thresholdSeats = Math.floor(totalSeats * (settings.occupancyThresholdPercent ?? 10) / 100);

      const dayReservations = await req.db.select().from(reservations)
        .where(and(
          eq(reservations.reservedDate, date as string),
          inArray(reservations.status, ['PENDING', 'CONFIRMED', 'SEATED']),
        ));

      const openMinutes = timeToMinutes(settings.openTime);
      let closeMinutes = timeToMinutes(settings.closeTime);
      if (closeMinutes <= openMinutes) closeMinutes += 1440;
      const interval = settings.slotIntervalMinutes;
      const duration = await getDurationForPartySize(ps, req.db);
      const buffer = settings.turnoverBufferMinutes;

      const slots: { time: string; available: boolean; seatsAvailable: number }[] = [];
      for (let mins = openMinutes; mins <= closeMinutes; mins += interval) {
        const normalizedMins = mins % 1440;
        const timeStr = `${String(Math.floor(normalizedMins / 60)).padStart(2, '0')}:${String(normalizedMins % 60).padStart(2, '0')}`;
        const slotStart = mins;
        const slotEnd = slotStart + duration;

        const occupiedTableIds = new Set<number>();
        let reservedPersons = 0;
        for (const r of dayReservations) {
          let rStart = timeToMinutes(r.reservedTime);
          if (rStart < openMinutes) rStart += 1440;
          const rEnd = rStart + r.durationMinutes + buffer;
          if (slotStart < rEnd && slotEnd > rStart) {
            for (const tid of getReservationTableIds(r)) {
              occupiedTableIds.add(tid);
            }
            reservedPersons += r.partySize;
          }
        }

        const freeTables = activeTables.filter(t => !occupiedTableIds.has(t.id));
        const freeSeats = freeTables.reduce((sum, t) => sum + t.capacity, 0);

        const canFitParty = findTableBlock(freeTables, ps).length > 0;
        const occupancyOk = reservedPersons + ps <= maxReservableSeats + thresholdSeats;
        const isAvailable = canFitParty && occupancyOk;

        slots.push({ time: timeStr, available: isAvailable, seatsAvailable: freeSeats });
      }

      const today = await getBusinessDate(req.tenantSchema);
      if (date === today) {
        const tzRes = await getTenantTimezone(req.tenantSchema);
        const crTime = getNowInTZ(tzRes);
        const currentMinutes = crTime.getHours() * 60 + crTime.getMinutes();
        for (const slot of slots) {
          if (timeToMinutes(slot.time) <= currentMinutes + 30) {
            slot.available = false;
          }
        }
      }

      res.json(slots);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/public/reservations/available-tables
  app.get("/api/public/reservations/available-tables", async (req, res) => {
    try {
      const { date, time, partySize } = req.query;
      if (!date || !time || !partySize) return res.status(400).json({ message: "date, time y partySize son requeridos" });
      const ps = parseInt(partySize as string);
      const duration = await getDurationForPartySize(ps, req.db);

      const settingsRows = await req.db.select().from(reservationSettings);
      const settings = settingsRows.length > 0 ? settingsRows[0] : { turnoverBufferMinutes: 15 };
      const buffer = settings.turnoverBufferMinutes;

      const allTables = await storage.getAllTables(false, req.db);
      const activeTables = allTables.filter(t => t.active);

      const dayReservations = await req.db.select().from(reservations)
        .where(and(
          eq(reservations.reservedDate, date as string),
          inArray(reservations.status, ['PENDING', 'CONFIRMED', 'SEATED']),
        ));

      const slotStart = timeToMinutes(time as string);
      const slotEnd = slotStart + duration;

      const occupiedTableIds = new Set<number>();
      for (const r of dayReservations) {
        const rStart = timeToMinutes(r.reservedTime);
        const rEnd = rStart + r.durationMinutes + buffer;
        if (slotStart < rEnd && slotEnd > rStart) {
          for (const tid of getReservationTableIds(r)) {
            occupiedTableIds.add(tid);
          }
        }
      }

      const available = activeTables
        .filter(t => !occupiedTableIds.has(t.id))
        .map(t => ({ id: t.id, tableName: t.tableName, tableCode: t.tableCode, capacity: t.capacity }));

      res.json(available);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== QUICKBOOKS ONLINE INTEGRATION ====================
  app.get("/api/qbo/auth-url", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const url = await qbo.getAuthUrl(req.db);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/callback", async (req, res) => {
    try {
      const { code, realmId, state } = req.query;
      if (!code || !realmId) return res.status(400).send("Missing code or realmId");
      if (!state || !qbo.validateOAuthState(state as string)) {
        return res.status(403).send("Invalid or expired OAuth state");
      }
      await qbo.handleOAuthCallback(code as string, realmId as string, req.db);
      res.redirect("/admin/quickbooks?connected=true");
    } catch (err: any) {
      console.error("[QBO] OAuth callback error:", err.message);
      res.redirect("/admin/quickbooks?error=" + encodeURIComponent(err.message));
    }
  });

  app.get("/api/qbo/status", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const config = await qbo.getQboConfig(req.db);
      if (!config) return res.json({ connected: false });
      res.json({
        connected: config.isConnected,
        realmId: config.realmId,
        connectedAt: config.connectedAt,
        lastTokenRefresh: config.lastTokenRefresh,
        depositAccountCash: config.depositAccountCash,
        depositAccountCard: config.depositAccountCard,
        depositAccountSinpe: config.depositAccountSinpe,
        taxCodeRef: config.taxCodeRef,
        syncFromDate: config.syncFromDate,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qbo/disconnect", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      await qbo.disconnectQBO(req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/credentials", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const status = await qbo.getCredentialStatus(req.db);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/qbo/credentials", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const { clientId, clientSecret, redirectUri, environment } = req.body;
      await qbo.saveCredentials({ clientId, clientSecret, redirectUri, environment }, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/qbo/settings", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      await qbo.updateQboSettings(req.body, req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/items", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const items = await qbo.getQBOItems(req.db);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/accounts", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const accounts = await qbo.getQBOAccounts(req.db);
      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/tax-codes", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const codes = await qbo.getQBOTaxCodes(req.db);
      res.json(codes);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/mappings", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const mappings = await qbo.getMappings(req.db);
      res.json(mappings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/qbo/mappings", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      await qbo.saveMappings(req.body.mappings || [], req.db);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/sync-log", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await qbo.getSyncLog(status, limit, offset, req.db);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qbo/sync-stats", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const stats = await qbo.getSyncStats(req.db);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qbo/retry-pending", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const count = await qbo.retryPendingSync();
      res.json({ ok: true, processed: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qbo/sync-log/:id/retry", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const logId = parseInt(req.params.id as string);
      if (isNaN(logId)) return res.status(400).json({ message: "ID inválido" });
      const ok = await qbo.resetSyncEntry(logId, req.db);
      if (!ok) return res.status(404).json({ message: "Entrada no encontrada o no es reintentable" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qbo/initial-sync", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const { fromDate } = req.body;
      if (!fromDate) return res.status(400).json({ message: "fromDate requerido" });
      const queued = await qbo.initialSync(fromDate, req.db);
      res.json({ ok: true, queued });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== BASIC INVENTORY CONTROL PANEL ====================
  app.get("/api/inventory/basic", requirePermission("MODULE_INV_VIEW"), async (req, res) => {
    try {
      const allProducts = await storage.getAllProducts(req.db);
      const allCategories = await storage.getAllCategories(req.db);
      const categoryMap = new Map(allCategories.map(c => [c.id, c]));

      const items = allProducts.map(p => {
        const cat = p.categoryId != null ? categoryMap.get(p.categoryId) : undefined;
        let status: string;
        if (p.availablePortions === null) {
          status = "ILIMITADO";
        } else if (p.availablePortions > 0) {
          status = "DISPONIBLE";
        } else {
          status = "AGOTADO";
        }
        const reorderAlert = p.availablePortions !== null && p.reorderPoint !== null && p.availablePortions <= p.reorderPoint;
        return {
          id: p.id,
          name: p.name,
          productCode: p.productCode,
          categoryId: p.categoryId,
          categoryName: cat?.name || null,
          parentCategoryCode: cat?.parentCategoryCode || null,
          availablePortions: p.availablePortions,
          reorderPoint: p.reorderPoint ?? null,
          reorderAlert,
          active: p.active,
          price: p.price,
          status,
        };
      });

      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inventory/basic/update", requirePermission("MODULE_INV_VIEW"), async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { productId, action, value } = req.body;

      if (!productId || !action) {
        return res.status(400).json({ message: "productId y action son requeridos" });
      }

      const product = await storage.getProduct(productId, req.db);
      if (!product) return res.status(404).json({ message: "Producto no encontrado" });

      let newPortions: number | null = product.availablePortions;
      let newActive = product.active;
      let auditAction = "";

      switch (action) {
        case "SET": {
          const qty = parseInt(value);
          if (isNaN(qty) || qty < 0) return res.status(400).json({ message: "Cantidad inválida" });
          newPortions = qty;
          newActive = qty > 0 ? true : false;
          auditAction = "BASIC_STOCK_SET";
          break;
        }
        case "ADJUST": {
          const delta = parseInt(value);
          if (isNaN(delta)) return res.status(400).json({ message: "Ajuste inválido" });
          if (product.availablePortions === null) {
            return res.status(400).json({ message: "No se puede ajustar un producto ilimitado. Primero establezca una cantidad." });
          }
          newPortions = Math.max(0, product.availablePortions + delta);
          newActive = newPortions > 0 ? true : product.active;
          auditAction = "BASIC_STOCK_ADJUST";
          break;
        }
        case "CLEAR": {
          newPortions = null;
          newActive = true;
          auditAction = "BASIC_STOCK_CLEAR";
          break;
        }
        case "ENABLE": {
          newActive = true;
          auditAction = "BASIC_MANUAL_ENABLE";
          break;
        }
        case "DISABLE": {
          newActive = false;
          auditAction = "BASIC_MANUAL_DISABLE";
          break;
        }
        case "SET_REORDER": {
          const rp = value === null || value === undefined || value === "" ? null : parseInt(value);
          if (rp !== null && (isNaN(rp) || rp < 0)) return res.status(400).json({ message: "Punto de reorden inválido" });
          await storage.updateProduct(productId, { reorderPoint: rp }, req.db);
          await storage.createAuditEvent({
            actorType: "USER",
            actorUserId: userId,
            action: "BASIC_REORDER_SET",
            entityType: "product",
            entityId: productId,
            metadata: { productName: product.name, previousReorderPoint: product.reorderPoint, newReorderPoint: rp },
          });
          const reorderAlert = product.availablePortions !== null && rp !== null && product.availablePortions <= rp;
          broadcast("product_availability_changed", { productId, reorderPoint: rp, reorderAlert });
          return res.json({ ok: true, reorderPoint: rp, reorderAlert });
        }
        default:
          return res.status(400).json({ message: "Acción no válida" });
      }

      await storage.updateProduct(productId, {
        availablePortions: newPortions,
        active: newActive,
      }, req.db);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: auditAction,
        entityType: "product",
        entityId: productId,
        metadata: {
          productName: product.name,
          previousPortions: product.availablePortions,
          newPortions,
          previousActive: product.active,
          newActive,
          value: value ?? null,
        },
      });

      broadcast("product_availability_changed", {
        productId,
        active: newActive,
        availablePortions: newPortions,
      });

      res.json({ ok: true, availablePortions: newPortions, active: newActive });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== REPORTS: QBO SYNC LEDGER ====================
  app.get("/api/reports/qbo-ledger", requirePermission("MODULE_ADMIN_VIEW"), async (req, res) => {
    try {
      const dateFrom = req.query.date_from as string || new Date().toISOString().split("T")[0];
      const dateTo = req.query.date_to as string || dateFrom;

      const paidPaymentRows = await req.db.select({
        paymentId: payments.id,
        orderId: payments.orderId,
        amount: payments.amount,
        paidAt: payments.paidAt,
        paymentMethodId: payments.paymentMethodId,
        businessDate: payments.businessDate,
      }).from(payments)
        .where(and(
          eq(payments.status, "PAID"),
          gte(payments.businessDate, dateFrom),
          lte(payments.businessDate, dateTo),
        ))
        .orderBy(desc(payments.paidAt));

      if (paidPaymentRows.length === 0) {
        return res.json([]);
      }

      const orderIds = [...new Set(paidPaymentRows.map(p => p.orderId))];
      const paymentIds = paidPaymentRows.map(p => p.paymentId);

      const [orderRows, syncRows, pmRows, ledgerRows] = await Promise.all([
        req.db.select({
          id: orders.id,
          globalNumber: orders.globalNumber,
          tableId: orders.tableId,
        }).from(orders).where(inArray(orders.id, orderIds)),
        req.db.select().from(qboSyncLog).where(inArray(qboSyncLog.paymentId, paymentIds)),
        storage.getAllPaymentMethods(req.db),
        req.db.select({
          orderId: salesLedgerItems.orderId,
          categoryName: salesLedgerItems.categoryNameSnapshot,
        }).from(salesLedgerItems).where(inArray(salesLedgerItems.orderId, orderIds)),
      ]);

      const allTables = await storage.getAllTables(false, req.db);
      const tableMap = new Map(allTables.map(t => [t.id, t.tableName]));
      const orderMap = new Map(orderRows.map(o => [o.id, o]));
      const syncMap = new Map(syncRows.map(s => [s.paymentId, s]));
      const pmMap = new Map(pmRows.map(m => [m.id, m.paymentName]));

      const catsByOrder = new Map<number, Set<string>>();
      for (const row of ledgerRows) {
        if (row.orderId && row.categoryName) {
          if (!catsByOrder.has(row.orderId)) catsByOrder.set(row.orderId, new Set());
          catsByOrder.get(row.orderId)!.add(row.categoryName);
        }
      }

      const result = paidPaymentRows.map(p => {
        const order = orderMap.get(p.orderId);
        const sync = syncMap.get(p.paymentId);
        const cats = catsByOrder.get(p.orderId);
        return {
          paymentId: p.paymentId,
          orderId: p.orderId,
          globalNumber: order?.globalNumber ? `G-${order.globalNumber}` : `#${p.orderId}`,
          businessDate: p.businessDate,
          paidAt: p.paidAt,
          tableName: order ? (order.tableId ? (tableMap.get(order.tableId) || `Mesa ${order.tableId}`) : ((order as any).quickSaleName || "Venta Rápida")) : "",
          amount: p.amount,
          paymentMethod: pmMap.get(p.paymentMethodId) || "Desconocido",
          categories: cats ? [...cats].sort().join(", ") : "",
          qboStatus: sync?.status || "NOT_SYNCED",
          qboSyncedAt: sync?.syncedAt || null,
          qboError: sync?.errorMessage || null,
          qboSyncLogId: sync?.id || null,
        };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  registerDispatchRoutes(app, broadcast);
  registerLoyaltyRoutes(app);
  registerProvisionRoutes(app);
  registerDataLoaderRoutes(app);

  return httpServer;
}
