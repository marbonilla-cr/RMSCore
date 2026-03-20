import type { Express, Request, Response, NextFunction } from "express";
import * as shortageStorage from "./shortage-storage";
import * as storage from "./storage";
import { auditEvents } from "@shared/schema";
import { db } from "./db";

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

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "No autenticado" });
  next();
}

export function registerShortageRoutes(app: Express, broadcast: (tenantId: number, event: string, data: any) => void) {

  app.get("/api/shortages/inv-items", requirePermission("SHORTAGES_REPORT"), async (_req: Request, res: Response) => {
    try {
      const { getAllInvItems } = await import("./inventory-storage");
      const items = await getAllInvItems();
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/shortages/products", requirePermission("SHORTAGES_REPORT"), async (req: Request, res: Response) => {
    try {
      const products = await storage.getAllProducts(req.db);
      res.json(products);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/shortages/categories", requirePermission("SHORTAGES_REPORT"), async (req: Request, res: Response) => {
    try {
      const categories = await storage.getAllCategories(req.db);
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shortages/report", requirePermission("SHORTAGES_REPORT"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { entityType, invItemId, menuProductId, notes, severityReport } = req.body;
      if (!entityType || !["INV_ITEM", "MENU_PRODUCT"].includes(entityType)) {
        return res.status(400).json({ message: "entityType inválido" });
      }
      if (!severityReport || !["LOW_STOCK", "NO_STOCK"].includes(severityReport)) {
        return res.status(400).json({ message: "severityReport inválido" });
      }
      if (entityType === "INV_ITEM" && !invItemId) {
        return res.status(400).json({ message: "invItemId requerido" });
      }
      if (entityType === "MENU_PRODUCT" && !menuProductId) {
        return res.status(400).json({ message: "menuProductId requerido" });
      }
      const result = await shortageStorage.reportShortage({
        entityType,
        invItemId: invItemId ? parseInt(invItemId) : undefined,
        menuProductId: menuProductId ? parseInt(menuProductId) : undefined,
        reportedByEmployeeId: user.id,
        notes,
        severityReport,
      });
      if (result.isNew) {
        broadcast(req.tenantId ?? 0, "shortage_created", { shortage: result.shortage });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shortages/active", requireAuth, async (_req: Request, res: Response) => {
    try {
      const shortages = await shortageStorage.getActiveShortages();
      res.json(shortages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shortages/active-count", requireAuth, async (_req: Request, res: Response) => {
    try {
      const count = await shortageStorage.getActiveShortageCount();
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shortages", requireAuth, async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const shortages = await shortageStorage.getAllShortages(status);
      res.json(shortages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shortages/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const shortage = await shortageStorage.getShortageById(id);
      if (!shortage) return res.status(404).json({ message: "Faltante no encontrado" });
      res.json(shortage);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shortages/:id/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const events = await shortageStorage.getShortageEvents(id);
      res.json(events);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/shortages/:id/ack", requirePermission("SHORTAGES_ACK"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id as string);
      const shortage = await shortageStorage.acknowledgeShortage(id, user.id, req.body?.message);
      broadcast(req.tenantId ?? 0, "shortage_updated", { shortage });
      res.json(shortage);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/shortages/:id/resolve", requirePermission("SHORTAGES_RESOLVE"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id as string);
      const shortage = await shortageStorage.resolveShortage(id, user.id, req.body?.message);
      broadcast(req.tenantId ?? 0, "shortage_updated", { shortage });
      res.json(shortage);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/shortages/:id/close", requirePermission("SHORTAGES_CLOSE"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!req.body?.message) return res.status(400).json({ message: "Nota obligatoria al cerrar" });
      const id = parseInt(req.params.id as string);
      const shortage = await shortageStorage.closeShortage(id, user.id, req.body.message);
      broadcast(req.tenantId ?? 0, "shortage_updated", { shortage });
      res.json(shortage);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/audit-alerts", requirePermission("AUDIT_VIEW"), async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const alerts = await shortageStorage.getAuditAlerts(status);
      res.json(alerts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/audit-alerts/:id/ack", requirePermission("AUDIT_MANAGE"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id as string);
      const alert = await shortageStorage.ackAuditAlert(id, user.id, req.body?.notes);
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/audit-alerts/:id/close", requirePermission("AUDIT_MANAGE"), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!req.body?.notes) return res.status(400).json({ message: "Nota obligatoria al cerrar alerta" });
      const id = parseInt(req.params.id as string);
      const alert = await shortageStorage.closeAuditAlert(id, user.id, req.body.notes);
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/shortages/toggle-availability/:productId", requirePermission("MENU_TOGGLE_AVAILABILITY"), async (req: Request, res: Response) => {
    try {
      const productId = parseInt(req.params.productId as string);
      const { active } = req.body;
      if (typeof active !== "boolean") return res.status(400).json({ message: "active debe ser booleano" });
      const product = await shortageStorage.toggleProductAvailability(productId, active);
      const user = (req as any).user;
      await db.insert(auditEvents).values({
        actorType: "user",
        actorUserId: user.id,
        action: active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
        entityType: "product",
        entityId: productId,
        metadata: { source: "shortages_module" },
      });
      broadcast(req.tenantId ?? 0, "product_availability_changed", { productId, active });
      res.json(product);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
