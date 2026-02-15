import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";
import * as storage from "./storage";
import { registerInventoryRoutes } from "./inventory-routes";
import { registerShortageRoutes } from "./shortage-routes";
import * as invStorage from "./inventory-storage";
import { loginSchema, pinLoginSchema, enrollPinSchema, insertBusinessConfigSchema, insertPrinterSchema, insertModifierGroupSchema, insertModifierOptionSchema, insertDiscountSchema, insertTaxCategorySchema, insertHrSettingsSchema, insertHrWeeklyScheduleSchema, insertHrScheduleDaySchema, insertHrTimePunchSchema, insertServiceChargeLedgerSchema, insertServiceChargePayoutSchema } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

async function getOrCreateOrderForTable(tableId: number, responsibleWaiterId: number | null) {
  let order = await storage.getOpenOrderForTable(tableId);
  if (order) return order;
  try {
    order = await storage.createOrder({
      tableId,
      status: "OPEN",
      responsibleWaiterId,
      businessDate: getBusinessDate(),
    });
  } catch (e: any) {
    order = await storage.getOpenOrderForTable(tableId);
    if (order) return order;
    throw e;
  }
  return order;
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
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(403).json({ message: "Sin permisos" });
    if (roles.includes(user.role)) {
      (req as any).user = user;
      return next();
    }
    const userPerms = await storage.getPermissionKeysForRole(user.role);
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
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    (req as any).user = user;
    const userPerms = await storage.getPermissionKeysForRole(user.role);
    for (const key of permissionKeys) {
      if (!userPerms.includes(key)) {
        return res.status(403).json({ message: "Sin permiso" });
      }
    }
    next();
  };
}

function getBusinessDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session setup
  const sessionSecret = process.env.SESSION_SECRET || "restaurant-secret-key-dev";
  const MemoryStore = (await import("memorystore")).default(session);

  app.set("trust proxy", 1);

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      proxy: true,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      },
    })
  );

  // ==================== AUTH ====================
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(username);
      if (!user || !user.active) {
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
      }
      const valid = await storage.verifyPassword(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
      }
      req.session.userId = user.id;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: user.id, action: "LOGIN_PASSWORD", entityType: "USER", entityId: user.id, metadata: {} });
      const { password: _, pin: _p, pinPlain: _pp, ...safeUser } = user;
      req.session.save((err) => {
        if (err) return res.status(500).json({ message: "Error de sesión" });
        res.json({ user: { ...safeUser, hasPin: !!user.pin } });
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.session.userId) {
      await storage.createAuditEvent({ actorType: "USER", actorUserId: req.session.userId, action: "LOGOUT", entityType: "USER", entityId: req.session.userId, metadata: {} });
    }
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "No autenticado" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    const { password: _, pin: _p, pinPlain: _pp, ...safeUser } = user;
    res.json({ ...safeUser, hasPin: !!user.pin });
  });

  // PIN Login
  app.post("/api/auth/pin-login", async (req, res) => {
    try {
      const { pin } = pinLoginSchema.parse(req.body);
      const allUsers = await storage.getAllUsersWithPin();
      const usersWithPin = allUsers.filter(u => u.pin && u.active);

      for (const u of usersWithPin) {
        if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) {
          continue;
        }
        const match = await storage.verifyPin(pin, u.pin!);
        if (match) {
          await storage.clearPinLock(u.id);
          req.session.userId = u.id;
          await storage.createAuditEvent({ actorType: "USER", actorUserId: u.id, action: "LOGIN_PIN", entityType: "USER", entityId: u.id, metadata: {} });
          const fullUser = await storage.getUser(u.id);
          if (!fullUser) return res.status(500).json({ message: "Error interno" });
          const { password: _, pin: _p, pinPlain: _pp, ...safeUser } = fullUser;
          return req.session.save((err) => {
            if (err) return res.status(500).json({ message: "Error de sesión" });
            res.json({ user: { ...safeUser, hasPin: true } });
          });
        }
      }

      // PIN not matched - we can't identify the user, so we can't increment a specific user's failed attempts
      // Just return generic error
      res.status(401).json({ message: "PIN incorrecto" });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // PIN Enrollment
  app.post("/api/auth/enroll-pin", requireAuth, async (req, res) => {
    try {
      const { pin } = enrollPinSchema.parse(req.body);
      await storage.enrollPin(req.session.userId!, pin);
      await storage.createAuditEvent({ actorType: "USER", actorUserId: req.session.userId!, action: "PIN_SET", entityType: "USER", entityId: req.session.userId!, metadata: {} });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // My permissions
  app.get("/api/auth/my-permissions", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "No autenticado" });
    const perms = await storage.getPermissionKeysForRole(user.role);
    res.json({ permissions: perms, role: user.role });
  });

  // ==================== ADMIN: EMPLOYEES ====================
  app.get("/api/admin/employees", requireRole("MANAGER"), async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const safe = allUsers.map(u => {
      const { password: _, pin: _p, ...rest } = u;
      return { ...rest, hasPin: !!u.pin, pinPlain: u.pinPlain || null };
    });
    res.json(safe);
  });

  app.post("/api/admin/employees", requireRole("MANAGER"), async (req, res) => {
    try {
      const { username, password, displayName, role, active, email } = req.body;
      if (!username || !password || !displayName || !role) {
        return res.status(400).json({ message: "Campos requeridos: username, password, displayName, role" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(400).json({ message: "Username ya existe" });
      const user = await storage.createUser({ username, password, displayName, role, active: active !== false, email: email || null });
      const { password: _, pin: _p, pinPlain: _pp, ...safeUser } = user;
      res.json({ ...safeUser, hasPin: !!user.pin, pinPlain: user.pinPlain || null });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/employees/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { displayName, role, active, email, username } = req.body;
      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (role !== undefined) updates.role = role;
      if (active !== undefined) updates.active = active;
      if (email !== undefined) updates.email = email;
      if (username !== undefined) {
        const existing = await storage.getUserByUsername(username);
        if (existing && existing.id !== id) return res.status(400).json({ message: "Username ya existe" });
        updates.username = username;
      }
      if (active === false) {
        const actor = (req as any).user;
        await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "USER_DISABLED", entityType: "USER", entityId: id, metadata: {} });
      }
      const user = await storage.updateUser(id, updates);
      const { password: _, pin: _p, pinPlain: _pp, ...safeUser } = user;
      res.json({ ...safeUser, hasPin: !!user.pin, pinPlain: user.pinPlain || null });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/reset-password", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "Password requerido" });
      await storage.updateUser(id, { password });
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PASSWORD_RESET", entityType: "USER", entityId: id, metadata: {} });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/reset-pin", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.resetPin(id);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PIN_RESET", entityType: "USER", entityId: id, metadata: {} });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/employees/:id/generate-pin", requireRole("MANAGER"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const pin = await storage.generateAndSetPin(id);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "PIN_GENERATED", entityType: "USER", entityId: id, metadata: {} });
      res.json({ pin });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PERMISSIONS ====================
  app.get("/api/admin/permissions", requireRole("MANAGER"), async (_req, res) => {
    const perms = await storage.getAllPermissions();
    res.json(perms);
  });

  app.get("/api/admin/role-permissions", requireRole("MANAGER"), async (_req, res) => {
    const roles = ["MANAGER", "CASHIER", "WAITER", "KITCHEN", "STAFF"];
    const result: Record<string, string[]> = {};
    for (const role of roles) {
      result[role] = await storage.getPermissionKeysForRole(role);
    }
    res.json(result);
  });

  app.put("/api/admin/role-permissions/:role", requireRole("MANAGER"), async (req, res) => {
    try {
      const role = req.params.role;
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) return res.status(400).json({ message: "permissions debe ser un array" });
      await storage.setRolePermissions(role, permissions);
      const actor = (req as any).user;
      await storage.createAuditEvent({ actorType: "USER", actorUserId: actor.id, action: "ROLE_PERMISSIONS_CHANGED", entityType: "ROLE", metadata: { role, permissions } });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: TABLES ====================
  app.get("/api/admin/tables", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllTables());
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
      const data = {
        tableCode: tableCode.trim(),
        tableName: tableName.trim(),
        active: active !== undefined ? Boolean(active) : true,
        sortOrder: typeof sortOrder === "number" ? sortOrder : parseInt(String(sortOrder)) || 0,
      };
      const table = await storage.createTable(data);
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
      const table = await storage.updateTable(parseInt(req.params.id), updates);
      res.json(table);
    } catch (err: any) {
      const msg = err.message || "Error al actualizar mesa";
      if (msg.includes("unique constraint")) {
        return res.status(400).json({ message: `Ya existe una mesa con el código "${req.body.tableCode}"` });
      }
      res.status(400).json({ message: msg });
    }
  });

  app.get("/api/admin/tables/:id/qr", requireRole("MANAGER"), async (req, res) => {
    const table = await storage.getTable(parseInt(req.params.id));
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
    const table = await storage.getTable(parseInt(req.params.id as string));
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
  app.get("/api/admin/categories", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllCategories());
  });

  app.post("/api/admin/categories", requireRole("MANAGER"), async (req, res) => {
    try {
      const cat = await storage.createCategory(req.body);
      res.json(cat);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/categories/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const cat = await storage.updateCategory(parseInt(req.params.id), req.body);
      res.json(cat);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PRODUCTS ====================
  app.get("/api/admin/products", requirePermission("MODULE_PRODUCTS_VIEW"), async (_req, res) => {
    res.json(await storage.getAllProducts());
  });

  app.post("/api/admin/products", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      if (!req.body.description || req.body.description.trim() === "") {
        return res.status(400).json({ message: "La descripción es obligatoria" });
      }
      const product = await storage.createProduct(req.body);
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
      const product = await storage.updateProduct(parseInt(req.params.id), req.body);
      res.json(product);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: PAYMENT METHODS ====================
  app.get("/api/admin/payment-methods", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllPaymentMethods());
  });

  app.post("/api/admin/payment-methods", requireRole("MANAGER"), async (req, res) => {
    try {
      const pm = await storage.createPaymentMethod(req.body);
      res.json(pm);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/payment-methods/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const pm = await storage.updatePaymentMethod(parseInt(req.params.id), req.body);
      res.json(pm);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // ==================== ADMIN: BUSINESS CONFIG ====================
  app.get("/api/admin/business-config", requireRole("MANAGER"), async (_req, res) => {
    const config = await storage.getBusinessConfig();
    res.json(config || { businessName: "", legalName: "", taxId: "", address: "", phone: "", email: "", legalNote: "" });
  });

  app.put("/api/admin/business-config", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertBusinessConfigSchema.parse(req.body);
      const config = await storage.upsertBusinessConfig(parsed);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Also expose business config for receipt printing (CASHIER + WAITER + MANAGER)
  app.get("/api/business-config", requireAuth, async (_req, res) => {
    const config = await storage.getBusinessConfig();
    res.json(config || { businessName: "", legalName: "", taxId: "", address: "", phone: "", email: "", legalNote: "" });
  });

  // ==================== ADMIN: PRINTERS ====================
  app.get("/api/admin/printers", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllPrinters());
  });

  app.post("/api/admin/printers", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertPrinterSchema.parse({
        ...req.body,
        port: Number(req.body.port) || 9100,
        paperWidth: Number(req.body.paperWidth) || 80,
      });
      const printer = await storage.createPrinter(parsed);
      res.json(printer);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/printers/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.port !== undefined) data.port = Number(data.port) || 9100;
      if (data.paperWidth !== undefined) data.paperWidth = Number(data.paperWidth) || 80;
      const printer = await storage.updatePrinter(parseInt(req.params.id), data);
      if (!printer) return res.status(404).json({ message: "Impresora no encontrada" });
      res.json(printer);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/admin/printers/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      await storage.deletePrinter(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: MODIFIERS ====================
  app.get("/api/admin/modifier-groups", requireRole("MANAGER"), async (_req, res) => {
    const groups = await storage.getAllModifierGroups();
    const result = [];
    for (const g of groups) {
      const options = await storage.getModifierOptionsByGroup(g.id);
      result.push({ ...g, options });
    }
    res.json(result);
  });

  app.post("/api/admin/modifier-groups", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertModifierGroupSchema.parse(req.body);
      const group = await storage.createModifierGroup(parsed);
      res.json(group);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/modifier-groups/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const group = await storage.updateModifierGroup(parseInt(req.params.id), req.body);
      res.json(group);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/modifier-groups/:id/options", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertModifierOptionSchema.parse({
        ...req.body,
        groupId: parseInt(req.params.id),
      });
      const option = await storage.createModifierOption(parsed);
      res.json(option);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/modifier-options/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const option = await storage.updateModifierOption(parseInt(req.params.id), req.body);
      res.json(option);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/admin/modifier-options/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      await storage.deleteModifierOption(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: DISCOUNTS ====================
  app.get("/api/admin/discounts", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllDiscounts());
  });

  app.post("/api/admin/discounts", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertDiscountSchema.parse(req.body);
      const discount = await storage.createDiscount(parsed);
      res.json(discount);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/discounts/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const discount = await storage.updateDiscount(parseInt(req.params.id), req.body);
      res.json(discount);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== ADMIN: TAX CATEGORIES ====================
  app.get("/api/admin/tax-categories", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllTaxCategories());
  });

  app.post("/api/admin/tax-categories", requireRole("MANAGER"), async (req, res) => {
    try {
      const parsed = insertTaxCategorySchema.parse(req.body);
      const tc = await storage.createTaxCategory(parsed);
      res.json(tc);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/tax-categories/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const tc = await storage.updateTaxCategory(parseInt(req.params.id), req.body);
      res.json(tc);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/recalc-open-orders", requireRole("MANAGER"), async (req, res) => {
    try {
      const openOrders = await storage.getOpenOrders();
      let recalced = 0;
      for (const order of openOrders) {
        await storage.recalcOrderTotal(order.id);
        recalced++;
      }
      res.json({ message: `${recalced} órdenes recalculadas`, recalced });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/admin/tax-categories/:id/apply-all", requireRole("MANAGER"), async (req, res) => {
    try {
      const taxCategoryId = parseInt(req.params.id);
      const tc = await storage.getTaxCategory(taxCategoryId);
      if (!tc) return res.status(404).json({ message: "Impuesto no encontrado" });
      const result = await storage.applyTaxToAllProducts(taxCategoryId);
      const openOrders = await storage.getOpenOrders();
      let recalced = 0;
      for (const order of openOrders) {
        await storage.recalcOrderTotal(order.id);
        recalced++;
      }
      res.json({ ...result, ordersRecalculated: recalced });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Product tax assignment
  app.get("/api/admin/products/:id/taxes", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    const ptcs = await storage.getProductTaxCategories(parseInt(req.params.id));
    res.json(ptcs.map(p => p.taxCategoryId));
  });

  app.put("/api/admin/products/:id/taxes", requirePermission("MODULE_PRODUCTS_VIEW"), async (req, res) => {
    try {
      const { taxCategoryIds } = req.body;
      if (!Array.isArray(taxCategoryIds)) return res.status(400).json({ message: "taxCategoryIds debe ser un array" });
      await storage.setProductTaxCategories(parseInt(req.params.id), taxCategoryIds);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== POS: DISCOUNTS LIST ====================
  app.get("/api/pos/discounts", requirePermission("POS_PAY"), async (_req, res) => {
    const all = await storage.getAllDiscounts();
    res.json(all.filter(d => d.active));
  });

  // ==================== POS: BULK APPLY DISCOUNT TO ALL ITEMS ====================
  app.post("/api/pos/orders/:orderId/discount-all", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const { discountName, discountType, discountValue } = req.body;
      const userId = req.session.userId!;

      if (!discountName || typeof discountName !== "string") return res.status(400).json({ message: "Nombre de descuento requerido" });
      if (discountType !== "percentage" && discountType !== "fixed") return res.status(400).json({ message: "Tipo de descuento inválido" });
      const numValue = Number(discountValue);
      if (isNaN(numValue) || numValue <= 0) return res.status(400).json({ message: "Valor de descuento inválido" });
      if (discountType === "percentage" && numValue > 100) return res.status(400).json({ message: "Porcentaje no puede ser mayor a 100" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const items = await storage.getOrderItems(orderId);
      const activeItems = items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");

      for (const orderItem of activeItems) {
        const mods = await storage.getOrderItemModifiers(orderItem.id);
        const unitPrice = Number(orderItem.productPriceSnapshot) + mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        const lineSubtotal = unitPrice * orderItem.qty;

        let amountApplied = 0;
        if (discountType === "percentage") {
          amountApplied = Math.round(lineSubtotal * Number(discountValue) / 100 * 100) / 100;
        } else {
          amountApplied = Math.min(Number(discountValue), lineSubtotal);
        }

        await storage.deleteOrderItemDiscountsByItem(orderItem.id);
        await storage.createOrderItemDiscount({
          orderItemId: orderItem.id,
          orderId,
          discountName,
          discountType,
          discountValue: discountValue.toString(),
          amountApplied: amountApplied.toFixed(2),
          appliedByUserId: userId,
        });
      }

      await storage.recalcOrderTotal(orderId);
      broadcast("order_updated", { orderId });

      res.json({ ok: true, itemsAffected: activeItems.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ITEM DISCOUNTS ====================
  app.post("/api/pos/order-items/:id/discount", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderItemId = parseInt(req.params.id);
      const { discountName, discountType, discountValue } = req.body;
      const userId = req.session.userId!;

      const orderItem = await storage.getOrderItem(orderItemId);
      if (!orderItem) return res.status(404).json({ message: "Item no encontrado" });

      const mods = await storage.getOrderItemModifiers(orderItemId);
      const unitPrice = Number(orderItem.productPriceSnapshot) + mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
      const lineSubtotal = unitPrice * orderItem.qty;

      let amountApplied = 0;
      if (discountType === "percentage") {
        amountApplied = Math.round(lineSubtotal * Number(discountValue) / 100 * 100) / 100;
      } else {
        amountApplied = Math.min(Number(discountValue), lineSubtotal);
      }

      await storage.deleteOrderItemDiscountsByItem(orderItemId);

      const discount = await storage.createOrderItemDiscount({
        orderItemId,
        orderId: orderItem.orderId,
        discountName,
        discountType,
        discountValue: discountValue.toString(),
        amountApplied: amountApplied.toFixed(2),
        appliedByUserId: userId,
      });

      await storage.recalcOrderTotal(orderItem.orderId);
      broadcast("order_updated", { orderId: orderItem.orderId });

      res.json(discount);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/pos/order-items/:id/discount", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const orderItemId = parseInt(req.params.id);
      const orderItem = await storage.getOrderItem(orderItemId);
      if (!orderItem) return res.status(404).json({ message: "Item no encontrado" });

      await storage.deleteOrderItemDiscountsByItem(orderItemId);
      await storage.recalcOrderTotal(orderItem.orderId);
      broadcast("order_updated", { orderId: orderItem.orderId });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ADD ITEMS TO ORDER ====================
  app.post("/api/pos/orders/:orderId/add-items", requirePermission("MODULE_POS_VIEW"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.session.userId!;
      const { items, sendToKds } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const table = order.tableId ? await storage.getTable(order.tableId) : null;
      const tableId = order.tableId || 0;
      const tableName = table?.tableName || "Mostrador";

      const existingItems = await storage.getOrderItems(order.id);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const allCategories = await storage.getAllCategories();
      const kdsTickets: Map<string, number> = new Map();
      const createdTicketIds: number[] = [];

      for (const item of items) {
        const product = await storage.getProduct(item.productId);
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
          });
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
        });

        const posTaxLinks = await storage.getProductTaxCategories(product.id);
        if (posTaxLinks.length > 0) {
          const allTaxCats = await storage.getAllTaxCategories();
          const taxSnapshot = posTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot });
          }
        }

        if (sendToKds) {
          await storage.updateOrderItem(orderItem.id, { sentToKitchenAt: new Date() });

          const ticketId = kdsTickets.get(kdsDestination)!;
          const modNotes = item.modifiers && item.modifiers.length > 0
            ? item.modifiers.map((m: any) => m.name).join(", ")
            : "";
          const fullNotes = [item.notes, modNotes].filter(Boolean).join(" | ");

          await storage.createKitchenTicketItem({
            kitchenTicketId: ticketId,
            orderItemId: orderItem.id,
            productNameSnapshot: product.name,
            qty: item.qty,
            notes: fullNotes || null,
            status: "NEW",
          });

          try { await invStorage.consumeForOrderItem(orderItem.id, product.id, item.qty, userId); } catch (e) { console.error("[inv] consumption error:", e); }
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const mod of item.modifiers) {
            await storage.createOrderItemModifier({
              orderItemId: orderItem.id,
              modifierOptionId: mod.optionId,
              nameSnapshot: mod.name,
              priceDeltaSnapshot: mod.priceDelta || "0",
              qty: mod.qty || 1,
            });
          }
        }

        await storage.decrementPortions(product.id, item.qty);

        const posModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const posUnitWithMods = Number(product.price) + posModDelta;

        await storage.createSalesLedgerItem({
          businessDate: getBusinessDate(),
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
        await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
      }
      await storage.recalcOrderTotal(order.id);

      for (const ticketId of createdTicketIds) {
        broadcast("kitchen_ticket_created", { ticketId, tableId, tableName });
      }
      broadcast("order_updated", { tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId });

      res.json({ ok: true, ticketIds: createdTicketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: TABLES ====================
  app.get("/api/waiter/tables", requireRole("WAITER", "MANAGER"), async (_req, res) => {
    const [allTables, allOpenOrders] = await Promise.all([
      storage.getAllTables(),
      storage.getAllOpenOrders(),
    ]);

    const parentOrders = allOpenOrders.filter(o => !o.parentOrderId);
    const orderByTable = new Map<number, typeof parentOrders[0]>();
    for (const o of parentOrders) {
      if (!orderByTable.has(o.tableId)) orderByTable.set(o.tableId, o);
    }

    const orderIds = parentOrders.map(o => o.id);
    const waiterIds = Array.from(new Set(parentOrders.filter(o => o.responsibleWaiterId).map(o => o.responsibleWaiterId!)));

    const [allItems, allSubs, waiters] = await Promise.all([
      storage.getOrderItemsByOrderIds(orderIds),
      storage.getPendingSubmissionsByOrderIds(orderIds),
      storage.getUsersByIds(waiterIds),
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

      return {
        id: t.id,
        tableCode: t.tableCode,
        tableName: t.tableName,
        active: t.active,
        hasOpenOrder: !!order,
        orderId: order?.id || null,
        orderStatus: order?.status || null,
        responsibleWaiterName: waiterName,
        openedAt: order?.openedAt?.toISOString() || null,
        pendingQrCount,
        itemCount,
        totalAmount: order?.totalAmount || null,
        lastSentToKitchenAt,
      };
    });
    res.json(result);
  });

  app.get("/api/waiter/tables/:id", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const table = await storage.getTable(parseInt(req.params.id));
    if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
    res.json(table);
  });

  app.get("/api/tables/:id/current", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const tableId = parseInt(req.params.id);
      const table = await storage.getTable(tableId);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await storage.getOpenOrderForTable(tableId);
      if (!order) {
        return res.json({ table, activeOrder: null, orderItems: [], pendingQrSubmissions: [] });
      }

      const items = await storage.getOrderItems(order.id);
      const itemIds = items.map(i => i.id);
      const allMods = itemIds.length > 0 ? await storage.getOrderItemModifiersByItemIds(itemIds) : [];
      const modsByItem = new Map<number, typeof allMods>();
      for (const m of allMods) {
        if (!modsByItem.has(m.orderItemId)) modsByItem.set(m.orderItemId, []);
        modsByItem.get(m.orderItemId)!.push(m);
      }
      const itemsWithMods = items.map(item => ({
        ...item,
        modifiers: modsByItem.get(item.id) || [],
      }));

      const pendingSubs = await storage.getPendingSubmissions(order.id);

      const subsWithItems = [];
      for (const sub of pendingSubs) {
        const subItems = itemsWithMods.filter(i => i.qrSubmissionId === sub.id);
        subsWithItems.push({ ...sub, items: subItems });
      }

      const voidedItemsList = await storage.getVoidedItemsForOrder(order.id);
      const voidedUserIds = [...new Set(voidedItemsList.map(i => i.voidedByUserId))];
      const voidedUsersMap = new Map<number, string>();
      for (const uid of voidedUserIds) {
        const u = await storage.getUser(uid);
        if (u) voidedUsersMap.set(uid, u.displayName);
      }
      const voidedItemsWithNames = voidedItemsList.map(i => ({
        ...i,
        voidedAt: i.voidedAt?.toISOString() || null,
        voidedByName: voidedUsersMap.get(i.voidedByUserId) || "Desconocido",
      }));

      res.json({ table, activeOrder: order, orderItems: itemsWithMods, pendingQrSubmissions: subsWithItems, voidedItems: voidedItemsWithNames });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/waiter/tables/:id/order", requireRole("WAITER", "MANAGER"), async (req, res) => {
    const tableId = parseInt(req.params.id);
    const order = await storage.getOpenOrderForTable(tableId);
    if (!order) return res.json({ order: null, items: [], pendingSubmissions: [] });

    const items = await storage.getOrderItems(order.id);
    const pendingSubs = await storage.getPendingSubmissions(order.id);

    const subsWithItems = [];
    for (const sub of pendingSubs) {
      const subItems = items.filter(i => i.qrSubmissionId === sub.id);
      subsWithItems.push({ ...sub, items: subItems });
    }

    res.json({ order, items, pendingSubmissions: subsWithItems });
  });

  app.get("/api/waiter/menu", requireRole("WAITER", "MANAGER"), async (_req, res) => {
    res.json(await storage.getActiveProducts());
  });

  app.get("/api/waiter/categories", requireRole("WAITER", "MANAGER"), async (_req, res) => {
    const allCats = await storage.getAllCategories();
    res.json(allCats.filter(c => c.active));
  });

  app.get("/api/products/:id/modifiers", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const links = await storage.getItemModifierGroups(productId);
      const groupIds = links.map(l => l.modifierGroupId);
      const [groups, allOptions] = await Promise.all([
        Promise.all(groupIds.map(id => storage.getModifierGroup(id))),
        Promise.all(groupIds.map(id => storage.getModifierOptionsByGroup(id))),
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
      const tableId = parseInt(req.params.id);
      const userId = req.session.userId!;
      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const table = await storage.getTable(tableId);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      // Get or create order (defensive: prevents duplicates via race condition)
      let order = await getOrCreateOrderForTable(tableId, userId);

      // Assign waiter if not assigned
      if (!order.responsibleWaiterId) {
        order = await storage.updateOrder(order.id, { responsibleWaiterId: userId });
      }

      // Get max round number
      const existingItems = await storage.getOrderItems(order.id);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      // Create items and group by KDS destination
      const allCategories = await storage.getAllCategories();
      const kdsTickets: Map<string, number> = new Map();
      const createdTicketIds: number[] = [];

      for (const item of items) {
        const product = await storage.getProduct(item.productId);
        if (!product || !product.active) continue;

        if (product.availablePortions !== null && product.availablePortions < item.qty) {
          return res.status(400).json({ message: `${product.name}: solo ${product.availablePortions} porciones disponibles` });
        }

        const category = allCategories.find(c => c.id === product.categoryId);
        const kdsDestination = category?.kdsDestination || "cocina";

        if (!kdsTickets.has(kdsDestination)) {
          const ticket = await storage.createKitchenTicket({
            orderId: order.id,
            tableId,
            tableNameSnapshot: table.tableName,
            status: "NEW",
            kdsDestination,
          });
          kdsTickets.set(kdsDestination, ticket.id);
          createdTicketIds.push(ticket.id);
        }

        const ticketId = kdsTickets.get(kdsDestination)!;

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
        });

        await storage.updateOrderItem(orderItem.id, { sentToKitchenAt: new Date() });

        const waiterTaxLinks = await storage.getProductTaxCategories(product.id);
        if (waiterTaxLinks.length > 0) {
          const allTaxCats = await storage.getAllTaxCategories();
          const taxSnapshot = waiterTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot });
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
            });
          }
        }

        const modNotes = item.modifiers && item.modifiers.length > 0
          ? item.modifiers.map((m: any) => m.name).join(", ")
          : "";
        const fullNotes = [item.notes, modNotes].filter(Boolean).join(" | ");

        await storage.createKitchenTicketItem({
          kitchenTicketId: ticketId,
          orderItemId: orderItem.id,
          productNameSnapshot: product.name,
          qty: item.qty,
          notes: fullNotes || null,
          status: "NEW",
        });

        try { await invStorage.consumeForOrderItem(orderItem.id, product.id, item.qty, userId); } catch (e) { console.error("[inv] consumption error:", e); }

        await storage.decrementPortions(product.id, item.qty);

        const waiterModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const waiterUnitWithMods = Number(product.price) + waiterModDelta;

        await storage.createSalesLedgerItem({
          businessDate: getBusinessDate(),
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
          sentToKitchenAt: new Date(),
        });

        await storage.createAuditEvent({
          actorType: "USER",
          actorUserId: userId,
          action: "ORDER_ITEM_CREATED",
          entityType: "order_item",
          entityId: orderItem.id,
          tableId,
          metadata: { productName: product.name, qty: item.qty },
        });
      }

      await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
      await storage.recalcOrderTotal(order.id);

      for (const ticketId of createdTicketIds) {
        broadcast("kitchen_ticket_created", { ticketId, tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId });

      res.json({ ok: true, ticketIds: createdTicketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: QR SUBMISSION ACCEPT ====================
  app.post("/api/waiter/qr-submissions/:id/accept", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id);
      const userId = req.session.userId!;
      const sub = await storage.getSubmission(subId);
      if (!sub || sub.status !== "PENDING") return res.status(400).json({ message: "Submission no válida" });

      const order = await storage.getOpenOrderForTable(sub.tableId);
      if (!order) return res.status(400).json({ message: "Orden no encontrada" });

      const table = await storage.getTable(sub.tableId);
      if (!table) return res.status(400).json({ message: "Mesa no encontrada" });

      // Update waiter on order if not set
      if (!order.responsibleWaiterId) {
        await storage.updateOrder(order.id, { responsibleWaiterId: userId });
      }

      // Accept submission
      await storage.updateSubmission(subId, {
        status: "ACCEPTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      });

      // Get pending items for this submission
      const orderItemsList = await storage.getOrderItems(order.id);
      const subItems = orderItemsList.filter(i => i.qrSubmissionId === subId);

      const createdTicketIds: number[] = [];

      if (subItems.length > 0) {
        const allCategories = await storage.getAllCategories();
        const allProducts = await Promise.all(subItems.map(i => storage.getProduct(i.productId)));
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
            });
            kdsTickets.set(kdsDestination, ticket.id);
            createdTicketIds.push(ticket.id);
          }

          const ticketId = kdsTickets.get(kdsDestination)!;

          await storage.updateOrderItem(item.id, {
            status: "SENT",
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          });

          await storage.createKitchenTicketItem({
            kitchenTicketId: ticketId,
            orderItemId: item.id,
            productNameSnapshot: item.productNameSnapshot,
            qty: item.qty,
            notes: item.notes,
            status: "NEW",
          });

          try { await invStorage.consumeForOrderItem(item.id, item.productId, item.qty, userId); } catch (e) { console.error("[inv] consumption error:", e); }

          await storage.decrementPortions(item.productId, item.qty);

          await storage.updateSalesLedgerItems(item.id, {
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          });
        }

        await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
        await storage.recalcOrderTotal(order.id);
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

      for (const ticketId of createdTicketIds) {
        broadcast("kitchen_ticket_created", { ticketId, tableId: sub.tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId: sub.tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId: sub.tableId });

      // Return full current view payload for immediate UI refresh
      const updatedOrder = await storage.getOpenOrderForTable(sub.tableId);
      const updatedItems = updatedOrder ? await storage.getOrderItems(updatedOrder.id) : [];
      const updatedPendingSubs = updatedOrder ? await storage.getPendingSubmissions(updatedOrder.id) : [];
      const updatedSubsWithItems = [];
      for (const s of updatedPendingSubs) {
        const sItems = updatedItems.filter(i => i.qrSubmissionId === s.id);
        updatedSubsWithItems.push({ ...s, items: sItems });
      }

      res.json({
        ok: true,
        ticketId,
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
      const orderId = parseInt(req.params.orderId);
      const itemId = parseInt(req.params.itemId);
      const userId = req.session.userId!;
      const user = (req as any).user;
      const { reason, qtyToVoid } = req.body;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      if (order.status === "PAID") {
        return res.status(403).json({ message: "No se puede anular ítems de una orden ya pagada" });
      }

      const item = await storage.getOrderItem(itemId);
      if (!item || item.orderId !== orderId) {
        return res.status(404).json({ message: "Ítem no encontrado en esta orden" });
      }

      if (item.status === "VOIDED") {
        return res.status(400).json({ message: "El ítem ya está anulado" });
      }

      if (item.sentToKitchenAt) {
        const userPerms = await storage.getEffectivePermissions(userId);
        if (!userPerms.includes("ORDERITEM_VOID_POST_KDS")) {
          return res.status(403).json({ message: "No tiene permiso para anular ítems ya enviados a cocina" });
        }
      }

      const effectiveQty = (typeof qtyToVoid === "number" && qtyToVoid > 0 && qtyToVoid <= item.qty) ? qtyToVoid : item.qty;
      const isFullVoid = effectiveQty >= item.qty;

      const table = await storage.getTable(order.tableId);
      const product = await storage.getProduct(item.productId);
      const allCategories = await storage.getAllCategories();
      const category = allCategories.find(c => c.id === product?.categoryId);

      if (isFullVoid) {
        await storage.updateOrderItem(itemId, {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedByUserId: userId,
        });
        await storage.updateSalesLedgerItems(itemId, { status: "VOIDED" });
      } else {
        const newQty = item.qty - effectiveQty;
        await storage.updateOrderItem(itemId, { qty: newQty });
        const newSubtotal = (Number(item.productPriceSnapshot) * newQty).toFixed(2);
        await storage.updateSalesLedgerItems(itemId, { qty: newQty, lineSubtotal: newSubtotal });
      }

      await storage.createVoidedItem({
        businessDate: order.businessDate || getBusinessDate(),
        tableId: order.tableId,
        tableNameSnapshot: table?.tableName || null,
        orderId,
        orderItemId: itemId,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        categorySnapshot: category?.name || null,
        qtyVoided: effectiveQty,
        unitPriceSnapshot: item.productPriceSnapshot,
        voidReason: reason || null,
        voidedByUserId: userId,
        voidedByRole: user.role,
        status: "VOIDED",
        notes: isFullVoid ? null : `Parcial: ${effectiveQty} de ${item.qty}`,
      });

      if (item.sentToKitchenAt) {
        await storage.incrementPortions(item.productId, effectiveQty);
        await storage.voidKitchenTicketItemsByOrderItem(itemId, effectiveQty, isFullVoid);
      }
      if (isFullVoid) {
        await storage.cancelPortionReservation(itemId);
        try { await invStorage.reverseConsumptionForOrderItem(itemId, userId); } catch (e) { console.error("[inv] reversal error:", e); }
      }

      await storage.recalcOrderTotal(orderId);

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
          reason: reason || null,
          role: user.role,
        },
      });

      broadcast("order_updated", { tableId: order.tableId, orderId });
      broadcast("table_status_changed", { tableId: order.tableId });
      if (item.sentToKitchenAt) {
        broadcast("kitchen_item_status_changed", { orderItemId: itemId, status: "VOIDED" });
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== MANAGER: HARD DELETE ORDER ITEM ====================
  app.delete("/api/waiter/orders/:orderId/items/:itemId", requireRole("MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const itemId = parseInt(req.params.itemId);
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const item = await storage.getOrderItem(itemId);
      if (!item || item.orderId !== orderId) {
        return res.status(404).json({ message: "Ítem no encontrado en esta orden" });
      }

      if (item.sentToKitchenAt && item.status !== "VOIDED") {
        await storage.incrementPortions(item.productId, item.qty);
      }

      await storage.deleteOrderItem(itemId);

      await storage.recalcOrderTotal(orderId);

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

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== WAITER: GET VOIDED ITEMS ====================
  app.get("/api/waiter/orders/:orderId/voided-items", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const items = await storage.getVoidedItemsForOrder(orderId);
      const userIds = [...new Set(items.map(i => i.voidedByUserId))];
      const usersMap = new Map<number, string>();
      for (const uid of userIds) {
        const u = await storage.getUser(uid);
        if (u) usersMap.set(uid, u.displayName);
      }
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
    const table = await storage.getTableByCode(req.params.tableCode);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });
    res.json({ tableName: table.tableName, tableCode: table.tableCode });
  });

  app.get("/api/qr/:tableCode/menu", async (req, res) => {
    const [table, prods, cats] = await Promise.all([
      storage.getTableByCode(req.params.tableCode as string),
      storage.getQRProducts(),
      storage.getAllCategories(),
    ]);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

    const catMap = new Map(cats.map(c => [c.id, c.name]));

    const result = prods
      .filter(p => p.availablePortions === null || p.availablePortions > 0)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        categoryName: p.categoryId ? catMap.get(p.categoryId) || null : null,
        availablePortions: p.availablePortions,
      }));

    res.json(result);
  });

  app.get("/api/qr/:tableCode/my-items", async (req, res) => {
    const table = await storage.getTableByCode(req.params.tableCode);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

    const order = await storage.getOpenOrderForTable(table.id);
    if (!order) return res.json([]);

    const items = await storage.getOrderItems(order.id);
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
      const rateLimitRecord = await storage.getQrRateLimit(tableCode);
      if (rateLimitRecord && (Date.now() - rateLimitRecord.lastSubmissionAt.getTime()) < 30000) {
        return res.status(429).json({ message: "Espere un momento antes de enviar otro pedido" });
      }

      const table = await storage.getTableByCode(tableCode);
      if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      // Get or create order (defensive: prevents duplicates via race condition)
      let order = await getOrCreateOrderForTable(table.id, null);

      // Get max round number
      const existingItems = await storage.getOrderItems(order.id);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      // Create QR submission
      const sub = await storage.createQrSubmission({
        orderId: order.id,
        tableId: table.id,
        status: "PENDING",
      });

      const allCategories = await storage.getAllCategories();

      for (const item of items) {
        const product = await storage.getProduct(item.productId);
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
        });

        const qrTaxLinks = await storage.getProductTaxCategories(product.id);
        if (qrTaxLinks.length > 0) {
          const allTaxCats = await storage.getAllTaxCategories();
          const taxSnapshot = qrTaxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot });
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
            });
          }
        }

        const qrModDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDelta || 0) * (m.qty || 1), 0);
        const qrUnitWithMods = Number(product.price) + qrModDelta;

        // Sales ledger
        await storage.createSalesLedgerItem({
          businessDate: getBusinessDate(),
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
        });
      }

      await storage.recalcOrderTotal(order.id);

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

      await storage.upsertQrRateLimit(tableCode);

      res.json({ ok: true, submissionId: sub.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== KDS ====================
  app.get("/api/kds/tickets/:type", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    const type = req.params.type;
    const destination = (req.query.destination as string) || undefined;
    let tickets;
    if (type === "active") {
      tickets = await storage.getActiveKitchenTickets(destination);
    } else {
      tickets = await storage.getHistoryKitchenTickets(destination);
    }

    const ticketIds = tickets.map(t => t.id);
    const allTicketItems = ticketIds.length > 0 ? await storage.getKitchenTicketItemsByTicketIds(ticketIds) : [];

    const allOrderItemIds = allTicketItems.map(i => i.orderItemId);
    const allMods = allOrderItemIds.length > 0 ? await storage.getOrderItemModifiersByItemIds(allOrderItemIds) : [];
    const modsByItem = new Map<number, typeof allMods>();
    for (const m of allMods) {
      if (!modsByItem.has(m.orderItemId)) modsByItem.set(m.orderItemId, []);
      modsByItem.get(m.orderItemId)!.push(m);
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
      }));
      result.push({
        ...t,
        createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
        items: itemsWithMods,
      });
    }
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

  async function recalcOrderStatusFromItems(orderId: number) {
    const items = await storage.getOrderItems(orderId);
    const activeItems = items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
    if (activeItems.length === 0) return;

    const allReady = activeItems.every(i => i.status === "READY");
    const allPreparingOrReady = activeItems.every(i => i.status === "PREPARING" || i.status === "READY");

    const order = await storage.getOrder(orderId);
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

    await storage.updateOrder(orderId, { status: newStatus });
    broadcast("order_updated", { orderId });
    broadcast("table_status_changed", {});
  }

  app.patch("/api/kds/items/:id", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const { status } = req.body;
      const data: any = { status };
      if (status === "PREPARING") data.prepStartedAt = new Date();
      if (status === "READY") data.readyAt = new Date();

      const item = await storage.updateKitchenTicketItem(itemId, data);

      if (item) {
        const orderItemStatus = status === "PREPARING" ? "PREPARING" : status === "READY" ? "READY" : item.status;
        await storage.updateOrderItem(item.orderItemId, { status: orderItemStatus });
        if (status === "READY") {
          await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() });
        }

        const ticket = await storage.getKitchenTicketByItemId(item.id);
        if (ticket) {
          await recalcOrderStatusFromItems(ticket.orderId);
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
      const ticketId = parseInt(req.params.id);
      const { status } = req.body;
      const ticket = await storage.updateKitchenTicket(ticketId, { status });

      const items = await storage.getKitchenTicketItems(ticketId);
      for (const item of items) {
        if (item.status !== "READY") {
          await storage.updateKitchenTicketItem(item.id, { status: "READY", readyAt: new Date() });
          await storage.updateOrderItem(item.orderItemId, { status: "READY" });
          await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() });
        }
      }

      if (ticket) {
        await recalcOrderStatusFromItems(ticket.orderId);
      }

      broadcast("kitchen_item_status_changed", { ticketId, status: "READY" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/kds/clear-history", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    const destination = (req.query.destination as string) || undefined;
    await storage.clearKitchenHistory(destination);
    res.json({ ok: true });
  });

  // ==================== POS: PAYMENT METHODS (for cashier access) ====================
  app.get("/api/pos/payment-methods", requirePermission("POS_VIEW"), async (_req, res) => {
    res.json(await storage.getAllPaymentMethods());
  });

  // ==================== POS ====================
  app.get("/api/pos/tables", requirePermission("POS_VIEW"), async (_req, res) => {
    const [allTables, allOpenOrders] = await Promise.all([
      storage.getAllTables(),
      storage.getAllOpenOrders(),
    ]);
    const tableMap = new Map(allTables.map(t => [t.id, t]));
    const relevantOrders = allOpenOrders.filter(o => tableMap.has(o.tableId));
    if (relevantOrders.length === 0) return res.json([]);

    const orderIds = relevantOrders.map(o => o.id);
    const allItems = await storage.getOrderItemsByOrderIds(orderIds);

    const activeItems = allItems.filter(i => i.status !== "VOIDED" && i.status !== "PENDING");
    const allItemIds = allItems.map(i => i.id);
    const activeItemIds = activeItems.map(i => i.id);

    const [allMods, allItemDiscounts, allItemTaxes] = await Promise.all([
      storage.getOrderItemModifiersByItemIds(activeItemIds),
      storage.getOrderItemDiscountsByItemIds(allItemIds),
      storage.getOrderItemTaxesByItemIds(allItemIds),
    ]);

    const modsMap = new Map<number, typeof allMods>();
    for (const m of allMods) {
      if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []);
      modsMap.get(m.orderItemId)!.push(m);
    }
    const discountsMap = new Map<number, typeof allItemDiscounts>();
    for (const d of allItemDiscounts) {
      if (!discountsMap.has(d.orderItemId)) discountsMap.set(d.orderItemId, []);
      discountsMap.get(d.orderItemId)!.push(d);
    }
    const taxesMap = new Map<number, typeof allItemTaxes>();
    for (const t of allItemTaxes) {
      if (!taxesMap.has(t.orderItemId)) taxesMap.set(t.orderItemId, []);
      taxesMap.get(t.orderItemId)!.push(t);
    }

    const itemsByOrder = new Map<number, typeof activeItems>();
    for (const item of activeItems) {
      if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
      itemsByOrder.get(item.orderId)!.push(item);
    }

    const allItemsByOrder = new Map<number, typeof allItems>();
    for (const item of allItems) {
      if (!allItemsByOrder.has(item.orderId)) allItemsByOrder.set(item.orderId, []);
      allItemsByOrder.get(item.orderId)!.push(item);
    }

    const result: any[] = [];
    for (const order of relevantOrders) {
      const orderActiveItems = itemsByOrder.get(order.id) || [];
      if (orderActiveItems.length === 0) continue;
      const table = tableMap.get(order.tableId)!;

      const itemsWithModifiers = orderActiveItems.map(item => ({
        ...item,
        modifiers: modsMap.get(item.id) || [],
        discounts: discountsMap.get(item.id) || [],
        taxes: taxesMap.get(item.id) || [],
      }));

      const orderAllItems = allItemsByOrder.get(order.id) || [];
      const orderAllItemIds = new Set(orderAllItems.map(i => i.id));
      const orderDiscountsList = allItemDiscounts.filter(d => orderAllItemIds.has(d.orderItemId));
      const orderTaxesList = allItemTaxes.filter(t => orderAllItemIds.has(t.orderItemId));

      const isChild = !!order.parentOrderId;
      const ticketNumber = isChild
        ? `${order.dailyNumber}-${order.splitIndex}`
        : `${order.dailyNumber}`;
      const displayName = isChild
        ? `${table.tableName} #${ticketNumber}`
        : `${table.tableName} #${order.dailyNumber}`;

      result.push({
        id: table.id,
        tableName: displayName,
        orderId: order.id,
        parentOrderId: order.parentOrderId || null,
        splitIndex: order.splitIndex || null,
        dailyNumber: order.dailyNumber,
        globalNumber: order.globalNumber,
        ticketNumber,
        totalAmount: order.totalAmount,
        openedAt: order.openedAt,
        itemCount: orderActiveItems.length,
        items: itemsWithModifiers,
        totalDiscounts: orderDiscountsList.reduce((s, d) => s + Number(d.amountApplied), 0).toFixed(2),
        totalTaxes: orderTaxesList.reduce((s, t) => s + Number(t.taxAmount), 0).toFixed(2),
        taxBreakdown: aggregateTaxBreakdown(orderTaxesList),
      });
    }
    res.json(result);
  });

  app.post("/api/pos/pay", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const { orderId, paymentMethodId, amount, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      
      const currentBalanceDue = Number(order.balanceDue || order.totalAmount || 0);
      const payAmount = Number(amount);
      if (payAmount > currentBalanceDue + 0.01) {
        return res.status(400).json({ message: `Monto excede el saldo pendiente (₡${currentBalanceDue.toFixed(2)})` });
      }

      const pm = (await storage.getAllPaymentMethods()).find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession();
        if (!cashSession) {
          return res.status(400).json({ message: "No hay caja abierta. Abra una sesión de caja antes de cobrar en efectivo." });
        }
      }

      const payment = await storage.createPayment({
        orderId,
        splitId: null,
        amount: payAmount.toFixed(2),
        paymentMethodId,
        cashierUserId: userId,
        status: "PAID",
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: getBusinessDate(),
      });

      const { balanceDue } = await storage.updateOrderPaymentTotals(orderId);

      if (balanceDue <= 0) {
        await storage.updateOrder(orderId, { status: "PAID", closedAt: new Date() });
        const items = await storage.getOrderItems(orderId);
        for (const item of items) {
          if (item.status !== "VOIDED") {
            await storage.updateOrderItem(item.id, { status: "PAID" });
            await storage.updateSalesLedgerItems(item.id, { status: "PAID", paidAt: new Date() });
          }
        }

        try {
          const hrSettings = await storage.getHrSettings();
          const scRate = hrSettings ? Number(hrSettings.serviceChargeRate) : 0.10;
          if (scRate > 0) {
            const allProducts = await storage.getAllProducts();
            const productMap = new Map(allProducts.map(p => [p.id, p]));
            const tableName = order.tableId ? (await storage.getTable(order.tableId))?.tableName : null;
            for (const item of items) {
              if (item.status === "VOIDED") continue;
              const prod = item.productId ? productMap.get(item.productId) : null;
              if (prod && !prod.serviceTaxApplicable) continue;
              const baseAmount = Number(item.unitPrice) * item.quantity;
              const serviceAmount = Math.round(baseAmount * scRate * 100) / 100;
              if (serviceAmount > 0) {
                await storage.createServiceChargeLedgerEntry({
                  businessDate: getBusinessDate(),
                  orderId,
                  orderItemId: item.id,
                  tableId: order.tableId || null,
                  tableNameSnapshot: tableName || null,
                  responsibleWaiterEmployeeId: order.responsibleWaiterId || null,
                  rateSnapshot: scRate.toFixed(4),
                  baseAmountSnapshot: baseAmount.toFixed(2),
                  serviceAmount: serviceAmount.toFixed(2),
                  status: "PAID",
                });
              }
            }
          }
        } catch (scErr) {
          console.error("[ServiceCharge] Error creating ledger entries:", scErr);
        }
      }

      if (pm?.paymentCode === "CASH") {
        const session = await storage.getActiveCashSession();
        if (session) {
          const newExpected = Number(session.expectedCash || session.openingCash) + payAmount;
          await storage.updateCashSession(session.id, { expectedCash: newExpected.toFixed(2) });
        }
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
        const paidOrder = await storage.getOrder(orderId);
        if (paidOrder?.parentOrderId) {
          const siblings = await storage.getChildOrders(paidOrder.parentOrderId);
          const allSiblingsPaid = siblings.every(s => s.status === "PAID" || s.status === "VOIDED");
          if (allSiblingsPaid) {
            const parentOrder = await storage.getOrder(paidOrder.parentOrderId);
            if (parentOrder && (parentOrder.status === "SPLIT" || parentOrder.status === "OPEN")) {
              const parentItems = await storage.getOrderItems(paidOrder.parentOrderId);
              const parentActive = parentItems.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
              if (parentActive.length === 0) {
                await storage.updateOrder(paidOrder.parentOrderId, { status: "PAID", closedAt: new Date() });
              }
            }
          }
        }
      }

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      res.json({ ok: true, paymentId: payment.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== CASH SESSION ====================
  app.get("/api/pos/cash-session", requirePermission("POS_VIEW"), async (req, res) => {
    const session = await storage.getLatestCashSession();
    if (!session) return res.json({});

    const user = (req as any).user;
    const userPerms = await storage.getPermissionKeysForRole(user.role);
    const canViewReport = userPerms.includes("POS_VIEW_CASH_REPORT");

    if (!session.closedAt) {
      const totalsByMethod = canViewReport ? await storage.getPaymentsByDateGrouped(getBusinessDate()) : undefined;
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
      const existing = await storage.getActiveCashSession();
      if (existing) return res.status(400).json({ message: "Ya hay una caja abierta" });

      const session = await storage.createCashSession({
        openedByUserId: req.session.userId!,
        openingCash: req.body.openingCash || "0",
      });

      await storage.updateCashSession(session.id, { expectedCash: req.body.openingCash || "0" });

      res.json(session);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/cash-session/close", requirePermission("CASH_CLOSE"), async (req, res) => {
    try {
      const session = await storage.getActiveCashSession();
      if (!session) return res.status(400).json({ message: "No hay caja abierta" });

      const countedCash = parseFloat(req.body.countedCash || "0");
      const expected = parseFloat(session.expectedCash?.toString() || session.openingCash);
      const difference = countedCash - expected;

      const totalsByMethod = await storage.getPaymentsByDateGrouped(getBusinessDate());

      const updated = await storage.updateCashSession(session.id, {
        closedAt: new Date(),
        closedByUserId: req.session.userId!,
        countedCash: countedCash.toFixed(2),
        difference: difference.toFixed(2),
        totalsByMethod,
        notes: req.body.notes || null,
      });

      res.json({ ...updated, totalsByMethod });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: ORDER PAYMENTS ====================
  app.get("/api/pos/orders/:orderId/payments", requirePermission("POS_VIEW"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const orderPayments = await storage.getPaymentsForOrder(orderId);
      const allMethods = await storage.getAllPaymentMethods();
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

  // ==================== POS: NORMALIZE FOR SPLIT ====================
  app.post("/api/pos/orders/:orderId/normalize-split", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const result = await storage.normalizeOrderItemsForSplit(orderId);
      if (result.normalized) {
        await storage.recalcOrderTotal(orderId);
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
      const orderId = parseInt(req.params.orderId);
      const splits = await storage.getSplitAccountsForOrder(orderId);
      const result = [];
      for (const split of splits) {
        const items = await storage.getSplitItemsForSplit(split.id);
        result.push({ ...split, items });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/orders/:orderId/splits", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const { label, orderItemIds } = req.body;
      if (!label || !orderItemIds || !orderItemIds.length) {
        return res.status(400).json({ message: "Label y orderItemIds son requeridos" });
      }

      const split = await storage.createSplitAccount({ orderId, label });

      for (const orderItemId of orderItemIds) {
        await storage.createSplitItem({ splitId: split.id, orderItemId });
      }

      const items = await storage.getSplitItemsForSplit(split.id);
      broadcast("order_updated", { orderId });
      res.json({ ...split, items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/pos/splits/:id", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSplitAccount(id);
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
        await storage.removeSplitItemByOrderItemId(fromSplitId, orderItemId);
      }

      if (toSplitId) {
        await storage.createSplitItem({ splitId: toSplitId, orderItemId });
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

      await storage.bulkMoveSplitItems(orderItemIds, fromSplitId || null, toSplitId || null);

      broadcast("order_updated", {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/split-order", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const { orderId } = req.body;
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status !== "OPEN" && order.status !== "IN_KITCHEN" && order.status !== "PREPARING" && order.status !== "READY") {
        return res.status(400).json({ message: "Orden no está abierta" });
      }

      const splits = await storage.getSplitAccountsForOrder(orderId);
      const splitsWithItems = [];
      for (const sp of splits) {
        const items = await storage.getSplitItemsForSplit(sp.id);
        if (items.length > 0) splitsWithItems.push({ ...sp, items });
      }

      if (splitsWithItems.length === 0) {
        return res.status(400).json({ message: "No hay subcuentas con items para separar" });
      }

      const allOrderItems = await storage.getOrderItems(orderId);
      const assignedItemIds = splitsWithItems.flatMap(s => s.items.map(si => si.orderItemId));
      const unassignedActive = allOrderItems.filter(i => !assignedItemIds.includes(i.id) && i.status !== "VOIDED" && i.status !== "PAID");

      const parentDailyNumber = order.dailyNumber || 0;
      const createdOrderIds: number[] = [];
      let splitIdx = 1;

      for (const sp of splitsWithItems) {
        const childOrder = await storage.createChildOrder({
          tableId: order.tableId,
          status: "OPEN",
          responsibleWaiterId: order.responsibleWaiterId,
          businessDate: order.businessDate,
          totalAmount: "0",
          parentOrderId: orderId,
          splitIndex: splitIdx,
          dailyNumber: parentDailyNumber,
          globalNumber: order.globalNumber,
        });

        for (const si of sp.items) {
          await storage.moveOrderItem(si.orderItemId, childOrder.id);
        }

        await storage.recalcOrderTotal(childOrder.id);
        createdOrderIds.push(childOrder.id);
        splitIdx++;
      }

      await storage.recalcOrderTotal(orderId);

      for (const sp of splits) {
        await storage.deleteSplitAccount(sp.id);
      }

      if (unassignedActive.length === 0) {
        await storage.updateOrder(orderId, { status: "SPLIT", closedAt: new Date() });
      }

      broadcast("order_updated", { orderId });
      broadcast("table_status_changed", {});

      res.json({ ok: true, parentOrderId: orderId, childOrderIds: createdOrderIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/pay-split", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const { splitId, paymentMethodId, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      const splitItemsList = await storage.getSplitItemsForSplit(splitId);
      if (!splitItemsList.length) return res.status(400).json({ message: "Split sin items" });

      const splitAccount = await storage.getSplitAccount(splitId);
      if (!splitAccount) return res.status(404).json({ message: "Split no encontrado" });

      const orderId = splitAccount.orderId;
      const orderItemsList = await storage.getOrderItems(orderId);

      let splitTotal = 0;
      for (const si of splitItemsList) {
        const oi = orderItemsList.find(i => i.id === si.orderItemId);
        if (oi) {
          const mods = await storage.getOrderItemModifiers(oi.id);
          const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
          const lineSubtotal = (Number(oi.productPriceSnapshot) + modDelta) * oi.qty;
          
          const itemDiscounts = await storage.getOrderItemDiscounts(oi.id);
          const discountAmount = itemDiscounts.reduce((s, d) => s + Number(d.amountApplied), 0);
          
          const itemTaxes = await storage.getOrderItemTaxes(oi.id);
          const additiveTax = itemTaxes.filter(t => !t.inclusiveSnapshot).reduce((s, t) => s + Number(t.taxAmount), 0);
          
          splitTotal += lineSubtotal - discountAmount + additiveTax;
        }
      }

      const pm = (await storage.getAllPaymentMethods()).find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession();
        if (!cashSession) {
          return res.status(400).json({ message: "No hay caja abierta. Abra una sesión de caja antes de cobrar en efectivo." });
        }
      }

      const payment = await storage.createPayment({
        orderId,
        splitId,
        amount: splitTotal.toFixed(2),
        paymentMethodId,
        cashierUserId: userId,
        status: "PAID",
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: getBusinessDate(),
      });

      const order = await storage.getOrder(orderId);
      for (const si of splitItemsList) {
        await storage.updateOrderItem(si.orderItemId, { status: "PAID" });
        await storage.updateSalesLedgerItems(si.orderItemId, { status: "PAID", paidAt: new Date() });
      }

      try {
        const hrSettings = await storage.getHrSettings();
        const scRate = hrSettings ? Number(hrSettings.serviceChargeRate) : 0.10;
        if (scRate > 0 && order) {
          const allProducts = await storage.getAllProducts();
          const productMap = new Map(allProducts.map(p => [p.id, p]));
          const tableName = order.tableId ? (await storage.getTable(order.tableId))?.tableName : null;
          for (const si of splitItemsList) {
            const oi = orderItemsList.find(i => i.id === si.orderItemId);
            if (!oi || oi.status === "VOIDED") continue;
            const prod = oi.productId ? productMap.get(oi.productId) : null;
            if (prod && !prod.serviceTaxApplicable) continue;
            const baseAmount = Number(oi.unitPrice) * oi.quantity;
            const serviceAmount = Math.round(baseAmount * scRate * 100) / 100;
            if (serviceAmount > 0) {
              await storage.createServiceChargeLedgerEntry({
                businessDate: getBusinessDate(),
                orderId,
                orderItemId: oi.id,
                tableId: order.tableId || null,
                tableNameSnapshot: tableName || null,
                responsibleWaiterEmployeeId: order.responsibleWaiterId || null,
                rateSnapshot: scRate.toFixed(4),
                baseAmountSnapshot: baseAmount.toFixed(2),
                serviceAmount: serviceAmount.toFixed(2),
                status: "PAID",
              });
            }
          }
        }
      } catch (scErr) {
        console.error("[ServiceCharge] Split payment ledger error:", scErr);
      }

      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession();
        if (cashSession) {
          const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) + splitTotal;
          await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) });
        }
      }

      await storage.updateOrderPaymentTotals(orderId);

      const allItems = await storage.getOrderItems(orderId);
      const allPaid = allItems.filter(i => i.status !== "VOIDED").every(i => i.status === "PAID");
      if (allPaid) {
        await storage.updateOrder(orderId, { status: "PAID", closedAt: new Date() });
      }

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      res.json({ ok: true, paymentId: payment.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PRINT RECEIPT (direct to printer) ====================
  app.post("/api/pos/print-receipt", requirePermission("POS_PRINT"), async (req, res) => {
    try {
      const { orderId } = req.body;
      if (!orderId || typeof orderId !== "number") return res.status(400).json({ message: "orderId requerido (número)" });

      const { buildReceiptBuffer, sendToPrinter } = await import("./escpos");

      const printersList = await storage.getAllPrinters();
      const cajaPrinter = printersList.find(p => p.type === "caja" && p.enabled && p.ipAddress);
      if (!cajaPrinter) {
        return res.status(400).json({ message: "No hay impresora de caja configurada y habilitada" });
      }

      const config = await storage.getBusinessConfig();
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const table = await storage.getTable(order.tableId);
      const items = await storage.getOrderItems(orderId);
      const activeItems = items.filter(i => i.status !== "VOIDED");

      const cashier = req.session.userId ? await storage.getUser(req.session.userId) : null;

      const receiptItems: { name: string; qty: number; price: number; total: number }[] = [];
      for (const i of activeItems) {
        const mods = await storage.getOrderItemModifiers(i.id);
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        receiptItems.push({
          name: i.productNameSnapshot + (mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : ""),
          qty: i.qty,
          price: Number(i.productPriceSnapshot) + modDelta,
          total: (Number(i.productPriceSnapshot) + modDelta) * i.qty,
        });
      }

      const oNum = order.globalNumber ? `G-${order.globalNumber}` : (order.dailyNumber ? `D-${order.dailyNumber}` : `#${order.id}`);

      const payments = await storage.getPaymentsForOrder(orderId);
      const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
      let paymentMethodName = "";
      if (lastPayment) {
        const pm = await storage.getPaymentMethod(lastPayment.paymentMethodId);
        paymentMethodName = pm?.paymentName || "";
      }

      const orderDiscountsList = await storage.getOrderItemDiscountsByOrder(orderId);
      const orderTaxesList = await storage.getOrderItemTaxesByOrder(orderId);
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
        paymentMethod: paymentMethodName,
        clientName: lastPayment?.clientNameSnapshot || undefined,
        cashierName: cashier?.displayName || undefined,
        date: new Date().toLocaleString("es-CR"),
      };

      const buffer = buildReceiptBuffer(receiptData, cajaPrinter.paperWidth);
      await sendToPrinter(cajaPrinter.ipAddress, cajaPrinter.port, buffer);

      res.json({ ok: true, printer: cajaPrinter.name });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      if (order.status !== "PAID" && order.status !== "OPEN" && order.status !== "IN_KITCHEN" && order.status !== "PREPARING" && order.status !== "READY") {
        return res.status(400).json({ message: "No se puede enviar tiquete para esta orden" });
      }

      const items = await storage.getOrderItems(orderId);
      const activeItems = items.filter(i => i.status !== "VOIDED");
      const table = await storage.getTable(order.tableId);
      let subtotal = 0;
      const emailItemsData: { name: string; qty: number; lineTotal: number }[] = [];
      for (const i of activeItems) {
        const mods = await storage.getOrderItemModifiers(i.id);
        const modDelta = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
        const lineTotal = (Number(i.productPriceSnapshot) + modDelta) * i.qty;
        subtotal += lineTotal;
        const modLabel = mods.length > 0 ? ` (${mods.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : "";
        emailItemsData.push({ name: i.productNameSnapshot + modLabel, qty: i.qty, lineTotal });
      }
      const orderDiscountsList = await storage.getOrderItemDiscountsByOrder(orderId);
      const orderTaxesList = await storage.getOrderItemTaxesByOrder(orderId);
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
      const dateStr = getBusinessDate();

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
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.session.userId!;
      const { reason } = req.body || {};

      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "Usuario no encontrado" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status === "PAID") return res.status(400).json({ message: "No se puede anular una orden ya pagada" });
      if (order.status === "VOIDED") return res.status(400).json({ message: "La orden ya está anulada" });

      const items = await storage.getOrderItems(orderId);
      const table = await storage.getTable(order.tableId);
      const allCategories = await storage.getAllCategories();

      for (const item of items) {
        if (item.status === "VOIDED") continue;

        const product = await storage.getProduct(item.productId);
        const category = allCategories.find(c => c.id === product?.categoryId);

        await storage.updateOrderItem(item.id, {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedByUserId: userId,
        });
        await storage.updateSalesLedgerItems(item.id, { status: "VOIDED" });

        await storage.createVoidedItem({
          businessDate: order.businessDate || getBusinessDate(),
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
          status: "VOIDED",
          notes: null,
        });

        if (item.sentToKitchenAt) {
          await storage.incrementPortions(item.productId, item.qty);
          await storage.voidKitchenTicketItemsByOrderItem(item.id, item.qty, true);
        }
      }

      await storage.updateOrder(orderId, { status: "VOIDED", closedAt: new Date(), totalAmount: "0" });

      if (order.parentOrderId) {
        const siblings = await storage.getChildOrders(order.parentOrderId);
        const allDone = siblings.every(s => s.status === "PAID" || s.status === "VOIDED");
        if (allDone) {
          const anyPaid = siblings.some(s => s.status === "PAID");
          const parentOrder = await storage.getOrder(order.parentOrderId);
          if (parentOrder) {
            const parentItems = await storage.getOrderItems(order.parentOrderId);
            const parentActive = parentItems.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
            if (parentActive.length === 0) {
              await storage.updateOrder(order.parentOrderId, { status: anyPaid ? "PAID" : "VOIDED", closedAt: new Date() });
            }
          }
        }
      }

      // Delete any split accounts
      const splits = await storage.getSplitAccountsForOrder(orderId);
      for (const split of splits) {
        await storage.deleteSplitAccount(split.id);
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

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: VOID PAYMENT ====================
  app.post("/api/pos/void-payment/:id", requirePermission("PAYMENT_CORRECT"), async (req, res) => {
    try {
      const paymentId = parseInt(req.params.id);
      const userId = req.session.userId!;

      const payment = await storage.getPayment(paymentId);
      if (!payment) return res.status(404).json({ message: "Pago no encontrado" });
      if (payment.status !== "PAID") return res.status(400).json({ message: "Este pago ya fue anulado" });

      await storage.voidPayment(paymentId, userId, req.body.voidReason || "Anulación de pago");

      const pm = (await storage.getAllPaymentMethods()).find(m => m.id === payment.paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession();
        if (cashSession) {
          const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) - Number(payment.amount);
          await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) });
        }
      }

      const { balanceDue } = await storage.updateOrderPaymentTotals(payment.orderId);

      const order = await storage.getOrder(payment.orderId);
      if (order && order.status === "PAID" && balanceDue > 0) {
        await storage.updateOrder(payment.orderId, { status: "OPEN", closedAt: null });
        await storage.voidServiceChargeByOrder(payment.orderId);
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

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: RECEIPT DATA (for screen print) ====================
  app.get("/api/pos/receipt-data/:orderId", requirePermission("POS_PRINT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const [table, items, orderPayments, allPaymentMethods] = await Promise.all([
        storage.getTable(order.tableId),
        storage.getOrderItems(orderId),
        storage.getPaymentsForOrder(orderId),
        storage.getAllPaymentMethods(),
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
        storage.getOrderItemModifiersByItemIds(activeItemIds),
        storage.getOrderItemDiscountsByOrder(orderId),
        storage.getOrderItemTaxesByOrder(orderId),
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

      res.json({
        items: receiptItems,
        total: Number(order.totalAmount),
        paymentMethod: paymentMethodName,
        tableName: table?.tableName || `Mesa ${order.tableId}`,
        orderNumber,
        clientName: paidPayments[0]?.clientNameSnapshot || undefined,
        totalDiscounts,
        totalTaxes,
        taxBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: PAID ORDERS LIST ====================
  app.get("/api/pos/paid-orders", requirePermission("MODULE_POS_VIEW"), async (req, res) => {
    try {
      const date = (req.query.date as string) || undefined;
      const [paidOrders, allTables] = await Promise.all([
        storage.getPaidOrdersForDate(date),
        storage.getAllTables(),
      ]);
      const tableMap = new Map(allTables.map(t => [t.id, t]));

      if (paidOrders.length === 0) return res.json([]);

      const orderIds = paidOrders.map(o => o.id);
      const [allItems, allPaymentsList, allPaymentMethods] = await Promise.all([
        storage.getOrderItemsByOrderIds(orderIds),
        storage.getPaymentsByOrderIds(orderIds),
        storage.getAllPaymentMethods(),
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
        const table = tableMap.get(order.tableId);
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

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: REOPEN TABLE ====================
  app.post("/api/pos/reopen/:orderId", requirePermission("PAYMENT_CORRECT"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status !== "PAID") return res.status(400).json({ message: "Solo se pueden reabrir ordenes pagadas" });

      const orderPayments = await storage.getPaymentsForOrder(orderId);
      const paidPayments = orderPayments.filter(p => p.status === "PAID");
      const allPMs = await storage.getAllPaymentMethods();
      const pmMap = new Map(allPMs.map(m => [m.id, m]));

      for (const p of paidPayments) {
        await storage.voidPayment(p.id, userId, "Reapertura de orden");
        const pm = pmMap.get(p.paymentMethodId);
        if (pm?.paymentCode === "CASH") {
          const cashSession = await storage.getActiveCashSession();
          if (cashSession) {
            const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) - Number(p.amount);
            await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) });
          }
        }
      }

      await storage.updateOrderPaymentTotals(orderId);
      await storage.updateOrder(orderId, { status: "OPEN", closedAt: null });

      const orderItemsList = await storage.getOrderItems(orderId);
      for (const item of orderItemsList) {
        if (item.status === "PAID") {
          await storage.updateOrderItem(item.id, { status: "OPEN" });
          await storage.updateSalesLedgerItems(item.id, { status: "OPEN", paidAt: null });
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
      const date = getBusinessDate();

      const job = await storage.createQboExportJob({
        businessDate: date,
        status: "PENDING",
        startedAt: new Date(),
        retryCount: 0,
      });

      const ledgerItems = await storage.getLedgerItemsForDate(date, "PAID");
      const paidPayments = await storage.getPaymentsForDate(date);
      const activePaidPayments = paidPayments.filter(p => p.status === "PAID");

      const ledgerSum = ledgerItems.reduce((s, i) => s + Number(i.lineSubtotal), 0);
      const paymentSum = activePaidPayments.reduce((s, p) => s + Number(p.amount), 0);

      if (Math.abs(ledgerSum - paymentSum) < 0.01) {
        await storage.updateQboExportJob(job.id, {
          status: "SUCCESS",
          finishedAt: new Date(),
          qboRefs: { ledgerTotal: ledgerSum, paymentTotal: paymentSum, itemCount: ledgerItems.length },
        });
      } else {
        await storage.updateQboExportJob(job.id, {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: `Mismatch: ledger=${ledgerSum.toFixed(2)}, payments=${paymentSum.toFixed(2)}`,
        });
      }

      const updatedJob = await storage.getQboExportJobs(date);

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
  app.get("/api/qbo/export", requireRole("MANAGER"), async (_req, res) => {
    const today = getBusinessDate();
    const jobs = await storage.getQboExportJobs(today);
    res.json(jobs);
  });

  // ==================== DASHBOARD ====================
  app.get("/api/dashboard", requireRole("MANAGER"), async (req, res) => {
    const dateFrom = typeof req.query.from === "string" ? req.query.from : undefined;
    const dateTo = typeof req.query.to === "string" ? req.query.to : undefined;
    const hourFrom = typeof req.query.hourFrom === "string" ? parseInt(req.query.hourFrom) : undefined;
    const hourTo = typeof req.query.hourTo === "string" ? parseInt(req.query.hourTo) : undefined;
    const data = await storage.getDashboardData(dateFrom, dateTo, hourFrom, hourTo);
    const resolvedFrom = dateFrom || getBusinessDate();
    const resolvedTo = dateTo || resolvedFrom;
    const ledgerDetails = resolvedFrom === resolvedTo
      ? await storage.getLedgerItemsForDate(resolvedFrom)
      : await storage.getLedgerItemsForDateRange(resolvedFrom, resolvedTo);
    const paymentMethodTotals = resolvedFrom === resolvedTo
      ? await storage.getPaymentsByDateGrouped(resolvedFrom)
      : await storage.getPaymentsByDateRangeGrouped(resolvedFrom, resolvedTo);
    res.json({ ...data, ledgerDetails, paymentMethodTotals });
  });

  app.post("/api/admin/truncate-transactions", requireRole("MANAGER"), async (req, res) => {
    try {
      await storage.truncateTransactionalData();
      res.json({ ok: true, message: "Datos transaccionales eliminados" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard/orders/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const detail = await storage.getOrderDetail(orderId);
      if (!detail) return res.status(404).json({ message: "Orden no encontrada" });
      res.json(detail);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== HR MODULE ====================

  // -- HR Settings --
  app.get("/api/hr/settings", requirePermission("HR_MANAGE_SETTINGS"), async (_req, res) => {
    const settings = await storage.getHrSettings();
    res.json(settings || {});
  });

  app.put("/api/hr/settings", requirePermission("HR_MANAGE_SETTINGS"), async (req, res) => {
    try {
      const settings = await storage.upsertHrSettings(req.body);
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
    const schedules = await storage.getWeeklySchedulesByWeek(weekStartDate);
    const result = [];
    for (const s of schedules) {
      const days = await storage.getScheduleDays(s.id);
      result.push({ ...s, days });
    }
    res.json(result);
  });

  app.get("/api/hr/schedules/my", requirePermission("HR_VIEW_SELF"), async (req, res) => {
    const weekStartDate = req.query.weekStartDate as string;
    if (!weekStartDate) return res.status(400).json({ message: "weekStartDate required" });
    const schedule = await storage.getWeeklySchedule(req.session.userId!, weekStartDate);
    if (!schedule) return res.json(null);
    const days = await storage.getScheduleDays(schedule.id);
    res.json({ ...schedule, days });
  });

  app.post("/api/hr/schedules", requirePermission("HR_MANAGE_SCHEDULES"), async (req, res) => {
    try {
      const { employeeId, weekStartDate, days } = req.body;
      if (!employeeId || !weekStartDate) return res.status(400).json({ message: "employeeId and weekStartDate required" });
      
      const existing = await storage.getWeeklySchedule(employeeId, weekStartDate);
      if (existing) return res.status(409).json({ message: "Schedule already exists for this employee/week" });
      
      const schedule = await storage.createWeeklySchedule({ employeeId, weekStartDate });
      let savedDays: any[] = [];
      if (days && Array.isArray(days) && days.length > 0) {
        savedDays = await storage.upsertScheduleDays(schedule.id, days);
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
      const schedule = await storage.updateWeeklySchedule(id, {});
      let savedDays: any[] = [];
      if (days && Array.isArray(days)) {
        savedDays = await storage.upsertScheduleDays(id, days);
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
      await storage.deleteWeeklySchedule(id);
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
      const { lat, lng, accuracy } = req.body;
      
      const openPunch = await storage.getOpenPunchForEmployee(employeeId);
      if (openPunch) return res.status(409).json({ message: "Ya tiene una entrada abierta. Marque salida primero." });
      
      const settings = await storage.getHrSettings();
      const now = new Date();
      const businessDate = getBusinessDate();
      
      let geoVerified = false;
      if (settings && settings.geoEnforcementEnabled && settings.geoRequiredForClockin && settings.businessLat && settings.businessLng) {
        if (!lat || !lng) return res.status(400).json({ message: "Ubicación requerida para marcar entrada" });
        if (accuracy && Number(accuracy) > (settings.geoAccuracyMaxMeters || 100)) {
          return res.status(400).json({ message: `Precisión GPS insuficiente (${Math.round(Number(accuracy))}m). Intente en un área abierta.` });
        }
        const distance = haversineDistance(Number(settings.businessLat), Number(settings.businessLng), Number(lat), Number(lng));
        if (distance > (settings.geoRadiusMeters || 120)) {
          return res.status(403).json({ message: `Fuera del rango permitido (${Math.round(distance)}m de ${settings.geoRadiusMeters || 120}m). Solicite override al gerente.` });
        }
        geoVerified = true;
      }
      
      // Find today's schedule to compute lateness
      const weekDay = now.getDay(); // 0=Sunday
      let lateMinutes = 0;
      let scheduledStartAt: Date | undefined;
      let scheduledEndAt: Date | undefined;
      
      // Get the Monday of this week
      const dayOffset = weekDay === 0 ? 6 : weekDay - 1;
      const mondayDate = new Date(now);
      mondayDate.setDate(mondayDate.getDate() - dayOffset);
      const weekStartDate = mondayDate.toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
      
      const schedule = await storage.getWeeklySchedule(employeeId, weekStartDate);
      if (schedule) {
        const days = await storage.getScheduleDays(schedule.id);
        const todaySchedule = days.find(d => d.dayOfWeek === weekDay);
        if (todaySchedule && !todaySchedule.isDayOff && todaySchedule.startTime) {
          const [h, m] = todaySchedule.startTime.split(":").map(Number);
          scheduledStartAt = new Date(now);
          scheduledStartAt.setHours(h, m, 0, 0);
          
          if (todaySchedule.endTime) {
            const [eh, em] = todaySchedule.endTime.split(":").map(Number);
            scheduledEndAt = new Date(now);
            scheduledEndAt.setHours(eh, em, 0, 0);
          }
          
          const graceMinutes = settings?.latenessGraceMinutes || 0;
          const diffMs = now.getTime() - scheduledStartAt.getTime();
          const diffMinutes = Math.floor(diffMs / 60000);
          if (diffMinutes > graceMinutes) {
            lateMinutes = diffMinutes - graceMinutes;
          }
        }
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
      });
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: employeeId,
        action: "CLOCK_IN",
        entityType: "HR_PUNCH",
        entityId: punch.id,
        metadata: { lateMinutes, geoVerified },
      });
      
      // Send late alert email if late
      if (lateMinutes > 0 && settings?.lateAlertEmailTo) {
        try {
          const user = await storage.getUser(employeeId);
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: settings.lateAlertEmailTo,
            subject: `[Tardía] ${user?.displayName || "Empleado"} - ${lateMinutes} min tarde`,
            text: `${user?.displayName} marcó entrada ${lateMinutes} minutos tarde el ${businessDate}.\nHora programada: ${scheduledStartAt?.toLocaleTimeString("es-CR") || "N/A"}\nHora de entrada: ${now.toLocaleTimeString("es-CR")}`,
          });
        } catch (emailErr) {
          console.error("[HR] Failed to send late alert email:", emailErr);
        }
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
      const { lat, lng, accuracy } = req.body;
      
      const openPunch = await storage.getOpenPunchForEmployee(employeeId);
      if (!openPunch) return res.status(404).json({ message: "No hay entrada abierta para marcar salida" });
      
      const settings = await storage.getHrSettings();
      const now = new Date();
      
      let geoVerified = false;
      if (settings && settings.geoEnforcementEnabled && settings.geoRequiredForClockout && settings.businessLat && settings.businessLng) {
        if (!lat || !lng) return res.status(400).json({ message: "Ubicación requerida para marcar salida" });
        if (accuracy && Number(accuracy) > (settings.geoAccuracyMaxMeters || 100)) {
          return res.status(400).json({ message: `Precisión GPS insuficiente (${Math.round(Number(accuracy))}m). Intente en un área abierta.` });
        }
        const distance = haversineDistance(Number(settings.businessLat), Number(settings.businessLng), Number(lat), Number(lng));
        if (distance > (settings.geoRadiusMeters || 120)) {
          return res.status(403).json({ message: `Fuera del rango permitido (${Math.round(distance)}m de ${settings.geoRadiusMeters || 120}m). Solicite override al gerente.` });
        }
        geoVerified = true;
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
      });
      
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: employeeId,
        action: "CLOCK_OUT",
        entityType: "HR_PUNCH",
        entityId: openPunch.id,
        metadata: { workedMinutes, overtimeMinutesDaily, geoVerified },
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
      const businessDate = getBusinessDate();
      
      if (action === "clock_in") {
        const openPunch = await storage.getOpenPunchForEmployee(employeeId);
        if (openPunch) return res.status(409).json({ message: "Ya tiene una entrada abierta" });
        
        const punch = await storage.createTimePunch({
          employeeId,
          businessDate,
          clockInAt: now,
          clockinGeoVerified: false,
          notes: `Override por gerente: ${reason || "Sin razón"}`,
        });
        
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
        const openPunch = await storage.getOpenPunchForEmployee(employeeId);
        if (!openPunch) return res.status(404).json({ message: "No hay entrada abierta" });
        
        const workedMs = now.getTime() - new Date(openPunch.clockInAt).getTime();
        const workedMinutes = Math.floor(workedMs / 60000);
        
        const updatedPunch = await storage.updateTimePunch(openPunch.id, {
          clockOutAt: now,
          clockOutType: "OVERRIDE",
          workedMinutes,
          notes: `Override por gerente: ${reason || "Sin razón"}`,
          clockoutGeoVerified: false,
        });
        
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

  // -- My current punch status --
  app.get("/api/hr/my-punch", requireAuth, async (req, res) => {
    const punch = await storage.getOpenPunchForEmployee(req.session.userId!);
    res.json(punch || null);
  });

  // -- Time Punches queries --
  app.get("/api/hr/punches", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const { date, dateFrom, dateTo, employeeId } = req.query;
    if (employeeId) {
      const punches = await storage.getTimePunchesByEmployee(
        Number(employeeId),
        (dateFrom as string) || undefined,
        (dateTo as string) || undefined
      );
      return res.json(punches);
    }
    if (dateFrom && dateTo) {
      return res.json(await storage.getTimePunchesByDateRange(dateFrom as string, dateTo as string));
    }
    if (date) {
      return res.json(await storage.getTimePunchesByDate(date as string));
    }
    return res.json(await storage.getTimePunchesByDate(getBusinessDate()));
  });

  app.get("/api/hr/punches/my", requirePermission("HR_VIEW_SELF"), async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    const punches = await storage.getTimePunchesByEmployee(
      req.session.userId!,
      (dateFrom as string) || undefined,
      (dateTo as string) || undefined
    );
    res.json(punches);
  });

  // -- Punch edit (manager) --
  app.patch("/api/hr/punches/:id", requirePermission("HR_EDIT_PUNCHES"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { clockInAt, clockOutAt, reason } = req.body;
      
      if (!reason) return res.status(400).json({ message: "Razón de edición obligatoria" });
      
      const existing = await storage.getTimePunch(id);
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
      
      const updated = await storage.updateTimePunch(id, updates);
      
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

  // -- Overtime report --
  app.get("/api/hr/overtime-report", requirePermission("HR_VIEW_TEAM"), async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ message: "dateFrom and dateTo required" });
    
    const punches = await storage.getTimePunchesByDateRange(dateFrom as string, dateTo as string);
    const employees = await storage.getAllUsers();
    
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
    
    const settings = await storage.getHrSettings();
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
    const entries = await storage.getServiceChargeLedgerByDateRange(dateFrom as string, dateTo as string);
    res.json(entries);
  });

  // -- Service charge payouts --
  app.get("/api/hr/service-payouts", requirePermission("SERVICE_VIEW_REPORTS"), async (req, res) => {
    const { periodStart, periodEnd } = req.query;
    if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
    const payouts = await storage.getServiceChargePayouts(periodStart as string, periodEnd as string);
    res.json(payouts);
  });

  app.post("/api/hr/service-payouts/generate", requirePermission("SERVICE_GENERATE_PAYOUTS"), async (req, res) => {
    try {
      const { periodStart, periodEnd } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      
      await storage.deleteServiceChargePayoutsByPeriod(periodStart, periodEnd, "PREVIEW");
      
      const entries = await storage.getServiceChargeLedgerByDateRange(periodStart, periodEnd);
      
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
        });
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
      
      const payouts = await storage.getServiceChargePayouts(periodStart, periodEnd);
      const previews = payouts.filter(p => p.status === "PREVIEW");
      
      if (previews.length === 0) return res.status(400).json({ message: "No hay liquidaciones en PREVIEW para finalizar" });
      
      const finalized = [];
      for (const p of previews) {
        const updated = await storage.updateServiceChargePayoutStatus(p.id, "FINALIZED");
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
  app.get("/api/hr/employees", requirePermission("HR_VIEW_TEAM", "HR_MANAGE_SCHEDULES"), async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers.filter(u => u.active).map(u => ({ id: u.id, displayName: u.displayName, role: u.role, username: u.username })));
  });

  // -- Open punches (for auto-process monitoring) --
  app.get("/api/hr/open-punches", requirePermission("HR_VIEW_TEAM"), async (_req, res) => {
    const openPunches = await storage.getAllOpenPunches();
    res.json(openPunches);
  });

  // ==================== INVENTORY MODULE ====================
  registerInventoryRoutes(app, null);

  // ==================== SHORTAGES MODULE ====================
  registerShortageRoutes(app, broadcast);

  // ==================== WEBSOCKET ====================
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        }
      } catch {}
    });
    ws.on("close", () => wsClients.delete(ws));
    ws.on("error", () => wsClients.delete(ws));
  });

  return httpServer;
}
