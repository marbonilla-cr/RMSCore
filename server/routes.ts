import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";
import * as storage from "./storage";
import { loginSchema, pinLoginSchema, enrollPinSchema, insertBusinessConfigSchema, insertPrinterSchema } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
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
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: "Sin permisos" });
    }
    (req as any).user = user;
    next();
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
  return new Date().toISOString().slice(0, 10);
}

const qrRateLimitMap = new Map<string, number>();

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

  // Seed data
  await storage.seedData();
  await storage.seedPermissions();

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
      const { password: _, pin: _p, ...safeUser } = user;
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
    const { password: _, pin: _p, ...safeUser } = user;
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
          const { password: _, pin: _p, ...safeUser } = fullUser;
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
      return { ...rest, hasPin: !!u.pin };
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
      const { password: _, pin: _p, ...safeUser } = user;
      res.json(safeUser);
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
      const { password: _, pin: _p, ...safeUser } = user;
      res.json({ ...safeUser, hasPin: !!user.pin });
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
  app.get("/api/admin/products", requireRole("MANAGER"), async (_req, res) => {
    res.json(await storage.getAllProducts());
  });

  app.post("/api/admin/products", requireRole("MANAGER"), async (req, res) => {
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

  app.patch("/api/admin/products/:id", requireRole("MANAGER"), async (req, res) => {
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

  // ==================== ADMIN: USERS ====================
  app.get("/api/admin/users", requireRole("MANAGER"), async (_req, res) => {
    const all = await storage.getAllUsers();
    res.json(all.map(({ password, ...u }) => u));
  });

  app.post("/api/admin/users", requireRole("MANAGER"), async (req, res) => {
    try {
      const user = await storage.createUser(req.body);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/admin/users/:id", requireRole("MANAGER"), async (req, res) => {
    try {
      const user = await storage.updateUser(parseInt(req.params.id), req.body);
      if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
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

  // ==================== WAITER: TABLES ====================
  app.get("/api/waiter/tables", requireRole("WAITER", "MANAGER"), async (_req, res) => {
    const allTables = await storage.getAllTables();
    const result = [];
    for (const t of allTables) {
      const order = await storage.getOpenOrderForTable(t.id);
      let waiterName = null;
      let pendingQrCount = 0;
      let itemCount = 0;
      let lastSentToKitchenAt: string | null = null;
      if (order) {
        if (order.responsibleWaiterId) {
          const waiter = await storage.getUser(order.responsibleWaiterId);
          waiterName = waiter?.displayName || null;
        }
        const subs = await storage.getPendingSubmissions(order.id);
        pendingQrCount = subs.length;
        const items = await storage.getOrderItems(order.id);
        itemCount = items.filter(i => i.status !== "VOIDED").length;
        const sentTimes = items
          .filter(i => i.status !== "VOIDED" && i.sentToKitchenAt)
          .map(i => new Date(i.sentToKitchenAt!).getTime());
        if (sentTimes.length > 0) {
          lastSentToKitchenAt = new Date(Math.max(...sentTimes)).toISOString();
        }
      }
      result.push({
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
      });
    }
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
      const pendingSubs = await storage.getPendingSubmissions(order.id);

      const subsWithItems = [];
      for (const sub of pendingSubs) {
        const subItems = items.filter(i => i.qrSubmissionId === sub.id);
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

      res.json({ table, activeOrder: order, orderItems: items, pendingQrSubmissions: subsWithItems, voidedItems: voidedItemsWithNames });
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

  // Waiter: Send round to kitchen
  app.post("/api/waiter/tables/:id/send-round", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const tableId = parseInt(req.params.id);
      const userId = req.session.userId!;
      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      const table = await storage.getTable(tableId);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      // Get or create order
      let order = await storage.getOpenOrderForTable(tableId);
      if (!order) {
        order = await storage.createOrder({
          tableId,
          status: "OPEN",
          responsibleWaiterId: userId,
          businessDate: getBusinessDate(),
        });
      }

      // Assign waiter if not assigned
      if (!order.responsibleWaiterId) {
        order = await storage.updateOrder(order.id, { responsibleWaiterId: userId });
      }

      // Get max round number
      const existingItems = await storage.getOrderItems(order.id);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      // Create kitchen ticket
      const ticket = await storage.createKitchenTicket({
        orderId: order.id,
        tableId,
        tableNameSnapshot: table.tableName,
        status: "NEW",
      });

      // Create items
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
          origin: "WAITER",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: "SENT",
          roundNumber,
          qrSubmissionId: null,
        });

        await storage.updateOrderItem(orderItem.id, { sentToKitchenAt: new Date() });

        await storage.createKitchenTicketItem({
          kitchenTicketId: ticket.id,
          orderItemId: orderItem.id,
          productNameSnapshot: product.name,
          qty: item.qty,
          notes: item.notes || null,
          status: "NEW",
        });

        // Decrement portions
        await storage.decrementPortions(product.id, item.qty);

        // Sales ledger
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
          unitPrice: product.price,
          lineSubtotal: (Number(product.price) * item.qty).toFixed(2),
          origin: "WAITER",
          createdByUserId: userId,
          responsibleWaiterId: userId,
          status: "OPEN",
          sentToKitchenAt: new Date(),
        });

        // Audit
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

      // Update order status and total
      await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
      await storage.recalcOrderTotal(order.id);

      broadcast("kitchen_ticket_created", { ticketId: ticket.id, tableId, tableName: table.tableName });
      broadcast("order_updated", { tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId });

      res.json({ ok: true, ticketId: ticket.id });
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

      let ticketId: number | null = null;

      if (subItems.length > 0) {
        // Create kitchen ticket
        const ticket = await storage.createKitchenTicket({
          orderId: order.id,
          tableId: sub.tableId,
          tableNameSnapshot: table.tableName,
          status: "NEW",
        });
        ticketId = ticket.id;

        for (const item of subItems) {
          await storage.updateOrderItem(item.id, {
            status: "SENT",
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          });

          await storage.createKitchenTicketItem({
            kitchenTicketId: ticket.id,
            orderItemId: item.id,
            productNameSnapshot: item.productNameSnapshot,
            qty: item.qty,
            notes: item.notes,
            status: "NEW",
          });

          // Decrement portions
          await storage.decrementPortions(item.productId, item.qty);

          // Update ledger
          await storage.updateSalesLedgerItems(item.id, {
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          });
        }

        // Update order status
        await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
        await storage.recalcOrderTotal(order.id);
      }

      // Audit
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "WAITER_ACCEPTED_QR",
        entityType: "qr_submission",
        entityId: subId,
        tableId: sub.tableId,
        metadata: { itemCount: subItems.length, submissionId: subId },
      });

      if (ticketId) {
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
    const table = await storage.getTableByCode(req.params.tableCode);
    if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

    const prods = await storage.getQRProducts();
    const cats = await storage.getAllCategories();
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
      const tableCode = req.params.tableCode;
      const lastSubmission = qrRateLimitMap.get(tableCode);
      if (lastSubmission && Date.now() - lastSubmission < 30000) {
        return res.status(429).json({ message: "Espere un momento antes de enviar otro pedido" });
      }

      const table = await storage.getTableByCode(tableCode);
      if (!table || !table.active) return res.status(404).json({ message: "Mesa no encontrada" });

      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "No hay items" });

      // Get or create order
      let order = await storage.getOpenOrderForTable(table.id);
      if (!order) {
        order = await storage.createOrder({
          tableId: table.id,
          status: "OPEN",
          responsibleWaiterId: null,
          businessDate: getBusinessDate(),
        });
      }

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
          notes: null,
          origin: "QR",
          createdByUserId: null,
          responsibleWaiterId: order.responsibleWaiterId,
          status: "PENDING",
          roundNumber,
          qrSubmissionId: sub.id,
        });

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
          unitPrice: product.price,
          lineSubtotal: (Number(product.price) * item.qty).toFixed(2),
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

      qrRateLimitMap.set(tableCode, Date.now());

      res.json({ ok: true, submissionId: sub.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== KDS ====================
  app.get("/api/kds/tickets/:type", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    const type = req.params.type;
    let tickets;
    if (type === "active") {
      tickets = await storage.getActiveKitchenTickets();
    } else {
      tickets = await storage.getHistoryKitchenTickets();
    }

    const result = [];
    for (const t of tickets) {
      const items = await storage.getKitchenTicketItems(t.id);
      const nonVoided = items.filter(i => i.status !== "VOIDED");
      if (type === "active" && nonVoided.length === 0) continue;
      result.push({
        ...t,
        createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
        items: nonVoided.map(i => ({
          ...i,
          prepStartedAt: i.prepStartedAt?.toISOString() || null,
          readyAt: i.readyAt?.toISOString() || null,
        })),
      });
    }
    res.json(result);
  });

  app.patch("/api/kds/items/:id", requireRole("KITCHEN", "MANAGER"), async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const { status } = req.body;
      const data: any = { status };
      if (status === "PREPARING") data.prepStartedAt = new Date();
      if (status === "READY") data.readyAt = new Date();

      const item = await storage.updateKitchenTicketItem(itemId, data);

      // Update order item status too
      if (item) {
        const orderItemStatus = status === "PREPARING" ? "PREPARING" : status === "READY" ? "READY" : item.status;
        await storage.updateOrderItem(item.orderItemId, { status: orderItemStatus });
        if (status === "READY") {
          await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() });
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
      await storage.updateKitchenTicket(ticketId, { status });

      // Also mark all items READY
      const items = await storage.getKitchenTicketItems(ticketId);
      for (const item of items) {
        if (item.status !== "READY") {
          await storage.updateKitchenTicketItem(item.id, { status: "READY", readyAt: new Date() });
          await storage.updateOrderItem(item.orderItemId, { status: "READY" });
          await storage.updateSalesLedgerItems(item.orderItemId, { kdsReadyAt: new Date() });
        }
      }

      broadcast("kitchen_item_status_changed", { ticketId, status: "READY" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/kds/clear-history", requireRole("KITCHEN", "MANAGER"), async (_req, res) => {
    await storage.clearKitchenHistory();
    res.json({ ok: true });
  });

  // ==================== POS: PAYMENT METHODS (for cashier access) ====================
  app.get("/api/pos/payment-methods", requirePermission("POS_VIEW"), async (_req, res) => {
    res.json(await storage.getAllPaymentMethods());
  });

  // ==================== POS ====================
  app.get("/api/pos/tables", requirePermission("POS_VIEW"), async (_req, res) => {
    const allTables = await storage.getAllTables();
    const result = [];
    for (const t of allTables) {
      const order = await storage.getOpenOrderForTable(t.id);
      if (!order) continue;
      const items = await storage.getOrderItems(order.id);
      const activeItems = items.filter(i => i.status !== "VOIDED" && i.status !== "PENDING");
      if (activeItems.length === 0) continue;
      result.push({
        id: t.id,
        tableName: t.tableName,
        orderId: order.id,
        dailyNumber: order.dailyNumber,
        globalNumber: order.globalNumber,
        totalAmount: order.totalAmount,
        itemCount: activeItems.length,
        items: activeItems,
      });
    }
    res.json(result);
  });

  app.post("/api/pos/pay", requirePermission("POS_PAY"), async (req, res) => {
    try {
      const { orderId, paymentMethodId, amount, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      const payment = await storage.createPayment({
        orderId,
        splitId: null,
        amount: amount.toString(),
        paymentMethodId,
        cashierUserId: userId,
        status: "PAID",
        clientNameSnapshot: clientName || null,
        clientEmailSnapshot: clientEmail || null,
        businessDate: getBusinessDate(),
      });

      // Mark order as PAID
      await storage.updateOrder(orderId, { status: "PAID", closedAt: new Date() });

      // Update ledger items
      const items = await storage.getOrderItems(orderId);
      for (const item of items) {
        if (item.status !== "VOIDED") {
          await storage.updateOrderItem(item.id, { status: "PAID" });
          await storage.updateSalesLedgerItems(item.id, { status: "PAID", paidAt: new Date() });
        }
      }

      // Update cash session expected cash if payment is CASH
      const pm = (await storage.getAllPaymentMethods()).find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const session = await storage.getActiveCashSession();
        if (session) {
          const newExpected = Number(session.expectedCash || session.openingCash) + Number(amount);
          await storage.updateCashSession(session.id, { expectedCash: newExpected.toFixed(2) });
        }
      }

      // Audit
      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "PAYMENT_CREATED",
        entityType: "payment",
        entityId: payment.id,
        tableId: null,
        metadata: { orderId, amount, paymentMethodId },
      });

      broadcast("payment_completed", { orderId });
      broadcast("table_status_changed", {});

      res.json({ ok: true, paymentId: payment.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== CASH SESSION ====================
  app.get("/api/pos/cash-session", requirePermission("POS_VIEW"), async (_req, res) => {
    const session = await storage.getLatestCashSession();
    res.json(session || {});
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

  app.post("/api/pos/pay-split", requirePermission("POS_SPLIT"), async (req, res) => {
    try {
      const { splitId, paymentMethodId, clientName, clientEmail } = req.body;
      const userId = req.session.userId!;

      const splitItems = await storage.getSplitItemsForSplit(splitId);
      if (!splitItems.length) return res.status(400).json({ message: "Split sin items" });

      const splitAccount = await storage.getSplitAccount(splitId);
      if (!splitAccount) return res.status(404).json({ message: "Split no encontrado" });

      const orderId = splitAccount.orderId;
      const orderItemsList = await storage.getOrderItems(orderId);

      let splitTotal = 0;
      for (const si of splitItems) {
        const oi = orderItemsList.find(i => i.id === si.orderItemId);
        if (oi) splitTotal += Number(oi.productPriceSnapshot) * oi.qty;
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

      for (const si of splitItems) {
        await storage.updateOrderItem(si.orderItemId, { status: "PAID" });
        await storage.updateSalesLedgerItems(si.orderItemId, { status: "PAID", paidAt: new Date() });
      }

      const pm = (await storage.getAllPaymentMethods()).find(m => m.id === paymentMethodId);
      if (pm?.paymentCode === "CASH") {
        const cashSession = await storage.getActiveCashSession();
        if (cashSession) {
          const newExpected = Number(cashSession.expectedCash || cashSession.openingCash) + splitTotal;
          await storage.updateCashSession(cashSession.id, { expectedCash: newExpected.toFixed(2) });
        }
      }

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

      const printersList = await storage.getPrinters();
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

      const receiptItems = activeItems.map(i => ({
        name: i.productNameSnapshot,
        qty: i.qty,
        price: Number(i.productPriceSnapshot),
        total: Number(i.productPriceSnapshot) * i.qty,
      }));

      const totalAmount = receiptItems.reduce((s, i) => s + i.total, 0);
      const oNum = order.globalNumber ? `G-${order.globalNumber}` : (order.dailyNumber ? `D-${order.dailyNumber}` : `#${order.id}`);

      const payments = await storage.getPaymentsForOrder(orderId);
      const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
      let paymentMethodName = "";
      if (lastPayment) {
        const pm = await storage.getPaymentMethod(lastPayment.paymentMethodId);
        paymentMethodName = pm?.paymentName || "";
      }

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
        totalAmount,
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

      if (order.status === "PAID") {
        const user = await storage.getUser(userId);
        if (!user || user.role !== "MANAGER") {
          return res.status(403).json({ message: "Solo gerente puede reenviar ticket después de pagar" });
        }
      }

      const items = await storage.getOrderItems(orderId);
      const activeItems = items.filter(i => i.status !== "VOIDED");
      const table = await storage.getTable(order.tableId);
      const total = activeItems.reduce((s, i) => s + Number(i.productPriceSnapshot) * i.qty, 0);

      let emailSent = false;
      let emailError = "";

      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM || (smtpUser ? `La Antigua Lechería <${smtpUser}>` : undefined);
      const dateStr = new Date().toISOString().split("T")[0];

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.default.createTransport({
            host: smtpHost,
            port: Number(process.env.SMTP_PORT || "587"),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: smtpUser, pass: smtpPass },
          });

          const itemRows = activeItems.map(i =>
            `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${i.productNameSnapshot}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">₡${(Number(i.productPriceSnapshot) * i.qty).toLocaleString()}</td></tr>`
          ).join("");

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
              <p style="font-size:18px;font-weight:bold;text-align:right">Total: ₡${total.toLocaleString()}</p>
              <p style="color:#999;font-size:12px;margin-top:24px;text-align:center">Gracias por su visita</p>
            </div>`;

          const textLines = activeItems.map(i => `${i.qty}x ${i.productNameSnapshot} - ₡${(Number(i.productPriceSnapshot) * i.qty).toLocaleString()}`);
          const text = [
            `Ticket de Consumo`,
            `Mesa: ${table?.tableName || "N/A"}`,
            clientName ? `Cliente: ${clientName}` : "",
            `Fecha: ${new Date().toLocaleString("es-CR")}`,
            `---`,
            ...textLines,
            `---`,
            `Total: ₡${total.toLocaleString()}`,
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

  // ==================== POS: VOID PAYMENT ====================
  app.post("/api/pos/void-payment/:id", requirePermission("POS_VOID"), async (req, res) => {
    try {
      const paymentId = parseInt(req.params.id);
      const userId = req.session.userId!;

      const payment = await storage.getPayment(paymentId);
      if (!payment) return res.status(404).json({ message: "Pago no encontrado" });

      await storage.voidPayment(paymentId);

      const orderItemsList = await storage.getOrderItems(payment.orderId);
      for (const item of orderItemsList) {
        if (item.status === "PAID") {
          await storage.updateOrderItem(item.id, { status: "OPEN" });
          await storage.updateSalesLedgerItems(item.id, { status: "OPEN", paidAt: null });
        }
      }

      await storage.updateOrder(payment.orderId, { status: "OPEN", closedAt: null });

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "PAYMENT_VOIDED",
        entityType: "payment",
        entityId: paymentId,
        tableId: null,
        metadata: { orderId: payment.orderId, amount: payment.amount },
      });

      broadcast("payment_voided", { orderId: payment.orderId, paymentId });
      broadcast("table_status_changed", {});
      broadcast("order_updated", { orderId: payment.orderId });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==================== POS: REOPEN TABLE ====================
  app.post("/api/pos/reopen/:orderId", requirePermission("POS_REOPEN"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.session.userId!;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      if (order.status !== "PAID") return res.status(400).json({ message: "Solo se pueden reabrir ordenes pagadas" });

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
        metadata: {},
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

  // ==================== WEBSOCKET ====================
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
    ws.on("error", () => wsClients.delete(ws));
  });

  return httpServer;
}
