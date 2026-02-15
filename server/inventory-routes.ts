import type { Express, Request, Response, NextFunction } from "express";
import { WebSocket } from "ws";
import * as invStorage from "./inventory-storage";
import * as storage from "./storage";
import {
  insertInvItemSchema,
  insertInvUomConversionSchema,
  insertInvMovementSchema,
  insertInvSupplierSchema,
  insertInvSupplierItemSchema,
  insertInvPurchaseOrderSchema,
  insertInvPurchaseOrderLineSchema,
  insertInvPhysicalCountSchema,
  insertInvRecipeSchema,
  insertInvRecipeLineSchema,
} from "@shared/schema";
import { db } from "./db";
import { invItems } from "@shared/schema";
import { eq, and, lt, asc } from "drizzle-orm";

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

function broadcast(wss: any, type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  if (wss && wss.clients) {
    wss.clients.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }
}

export function registerInventoryRoutes(app: Express, wss: any) {
  app.get("/api/inv/items", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllInvItems());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/items/:id", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      const item = await invStorage.getInvItem(parseInt(req.params.id));
      if (!item) return res.status(404).json({ message: "Item no encontrado" });
      const conversions = await invStorage.getUomConversions(item.id);
      res.json({ ...item, uomConversions: conversions });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/items", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const parsed = insertInvItemSchema.parse(req.body);
      const item = await invStorage.createInvItem(parsed);
      broadcast(wss, "INV_ITEM_CREATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/items/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const item = await invStorage.updateInvItem(parseInt(req.params.id), req.body);
      if (!item) return res.status(404).json({ message: "Item no encontrado" });
      broadcast(wss, "INV_ITEM_UPDATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/items/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const item = await invStorage.deleteInvItem(parseInt(req.params.id));
      if (!item) return res.status(404).json({ message: "Item no encontrado" });
      broadcast(wss, "INV_ITEM_DELETED", item);
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/items/:id/uom-conversions", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      res.json(await invStorage.getUomConversions(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/items/:id/uom-conversions", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const parsed = insertInvUomConversionSchema.parse({ ...req.body, invItemId: parseInt(req.params.id) });
      const conv = await invStorage.createUomConversion(parsed);
      broadcast(wss, "INV_UOM_CONVERSION_CREATED", conv);
      res.json(conv);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/uom-conversions/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const conv = await invStorage.updateUomConversion(parseInt(req.params.id), req.body);
      if (!conv) return res.status(404).json({ message: "Conversión no encontrada" });
      broadcast(wss, "INV_UOM_CONVERSION_UPDATED", conv);
      res.json(conv);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/uom-conversions/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      await invStorage.deleteUomConversion(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/items/:id/movements", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      res.json(await invStorage.getInvMovements(parseInt(req.params.id), limit));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/movements", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const user = (req as any).user;
      const parsed = insertInvMovementSchema.parse({
        ...req.body,
        movementType: req.body.movementType || "ADJUSTMENT",
        createdByEmployeeId: user.id,
      });
      const movement = await invStorage.createInvMovement(parsed);
      broadcast(wss, "INV_MOVEMENT_CREATED", movement);
      res.json(movement);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/inv/suppliers", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllSuppliers());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/suppliers/:id", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      const supplier = await invStorage.getSupplier(parseInt(req.params.id));
      if (!supplier) return res.status(404).json({ message: "Proveedor no encontrado" });
      const items = await invStorage.getSupplierItems(supplier.id);
      res.json({ ...supplier, supplierItems: items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/suppliers", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      const parsed = insertInvSupplierSchema.parse(req.body);
      const supplier = await invStorage.createSupplier(parsed);
      broadcast(wss, "INV_SUPPLIER_CREATED", supplier);
      res.json(supplier);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/suppliers/:id", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      const supplier = await invStorage.updateSupplier(parseInt(req.params.id), req.body);
      if (!supplier) return res.status(404).json({ message: "Proveedor no encontrado" });
      broadcast(wss, "INV_SUPPLIER_UPDATED", supplier);
      res.json(supplier);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/suppliers/:id", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      const supplier = await invStorage.deleteSupplier(parseInt(req.params.id));
      if (!supplier) return res.status(404).json({ message: "Proveedor no encontrado" });
      broadcast(wss, "INV_SUPPLIER_DELETED", supplier);
      res.json(supplier);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/suppliers/:id/items", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      res.json(await invStorage.getSupplierItems(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/supplier-items", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      const parsed = insertInvSupplierItemSchema.parse(req.body);
      const item = await invStorage.createSupplierItem(parsed);
      broadcast(wss, "INV_SUPPLIER_ITEM_CREATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/supplier-items/:id", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      const item = await invStorage.updateSupplierItem(parseInt(req.params.id), req.body);
      if (!item) return res.status(404).json({ message: "Ítem de proveedor no encontrado" });
      broadcast(wss, "INV_SUPPLIER_ITEM_UPDATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/supplier-items/:id", requirePermission("INV_MANAGE_SUPPLIERS"), async (req, res) => {
    try {
      await invStorage.deleteSupplierItem(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/purchase-orders", requirePermission("INV_MANAGE_PO"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllPurchaseOrders());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/purchase-orders/:id", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const po = await invStorage.getPurchaseOrder(parseInt(req.params.id));
      if (!po) return res.status(404).json({ message: "Orden de compra no encontrada" });
      const lines = await invStorage.getPurchaseOrderLines(po.id);
      res.json({ ...po, lines });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/purchase-orders", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const user = (req as any).user;
      const parsed = insertInvPurchaseOrderSchema.parse({
        ...req.body,
        createdByEmployeeId: user.id,
      });
      const po = await invStorage.createPurchaseOrder(parsed);
      broadcast(wss, "INV_PO_CREATED", po);
      res.json(po);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/purchase-orders/:id", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const po = await invStorage.updatePurchaseOrder(parseInt(req.params.id), req.body);
      if (!po) return res.status(404).json({ message: "Orden de compra no encontrada" });
      broadcast(wss, "INV_PO_UPDATED", po);
      res.json(po);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/purchase-orders/:id/send", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const po = await invStorage.sendPurchaseOrder(parseInt(req.params.id));
      if (!po) return res.status(404).json({ message: "Orden de compra no encontrada" });
      broadcast(wss, "INV_PO_SENT", po);
      res.json(po);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/purchase-orders/:id/receive", requirePermission("INV_RECEIVE_PO"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { lines, note } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "Debe incluir líneas de recepción" });
      }
      const receipt = await invStorage.receivePurchaseOrder(
        parseInt(req.params.id),
        user.id,
        lines,
        note
      );
      broadcast(wss, "INV_PO_RECEIVED", { purchaseOrderId: parseInt(req.params.id), receipt });
      res.json(receipt);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/inv/purchase-orders/:id/lines", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      res.json(await invStorage.getPurchaseOrderLines(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/purchase-orders/:id/lines", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const parsed = insertInvPurchaseOrderLineSchema.parse({
        ...req.body,
        purchaseOrderId: parseInt(req.params.id),
      });
      const line = await invStorage.createPurchaseOrderLine(parsed);
      broadcast(wss, "INV_PO_LINE_CREATED", line);
      res.json(line);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/po-lines/:id", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      const line = await invStorage.updatePurchaseOrderLine(parseInt(req.params.id), req.body);
      if (!line) return res.status(404).json({ message: "Línea no encontrada" });
      broadcast(wss, "INV_PO_LINE_UPDATED", line);
      res.json(line);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/po-lines/:id", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      await invStorage.deletePurchaseOrderLine(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/purchase-orders/:id/receipts", requirePermission("INV_MANAGE_PO"), async (req, res) => {
    try {
      res.json(await invStorage.getPoReceipts(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/physical-counts", requirePermission("INV_PHYSICAL_COUNT"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllPhysicalCounts());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/physical-counts/:id", requirePermission("INV_PHYSICAL_COUNT"), async (req, res) => {
    try {
      const count = await invStorage.getPhysicalCount(parseInt(req.params.id));
      if (!count) return res.status(404).json({ message: "Conteo no encontrado" });
      const lines = await invStorage.getPhysicalCountLines(count.id);
      res.json({ ...count, lines });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/physical-counts", requirePermission("INV_PHYSICAL_COUNT"), async (req, res) => {
    try {
      const user = (req as any).user;
      const parsed = insertInvPhysicalCountSchema.parse({
        ...req.body,
        createdByEmployeeId: user.id,
      });
      const count = await invStorage.createPhysicalCount(parsed);
      broadcast(wss, "INV_PHYSICAL_COUNT_CREATED", count);
      res.json(count);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/physical-count-lines/:id", requirePermission("INV_PHYSICAL_COUNT"), async (req, res) => {
    try {
      const { countedQtyBase, adjustmentReason } = req.body;
      const line = await invStorage.updatePhysicalCountLine(parseInt(req.params.id), {
        countedQtyBase,
        adjustmentReason,
      });
      if (!line) return res.status(404).json({ message: "Línea no encontrada" });
      res.json(line);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/physical-counts/:id/finalize", requirePermission("INV_PHYSICAL_COUNT"), async (req, res) => {
    try {
      const user = (req as any).user;
      const count = await invStorage.finalizePhysicalCount(parseInt(req.params.id), user.id);
      broadcast(wss, "INV_PHYSICAL_COUNT_FINALIZED", count);
      res.json(count);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/inv/recipes/product/:productId", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      res.json(await invStorage.getRecipesForProduct(parseInt(req.params.productId)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/recipes/:id", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const recipe = await invStorage.getRecipe(parseInt(req.params.id));
      if (!recipe) return res.status(404).json({ message: "Receta no encontrada" });
      const lines = await invStorage.getRecipeLines(recipe.id);
      res.json({ ...recipe, lines });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/recipes", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const parsed = insertInvRecipeSchema.parse(req.body);
      const recipe = await invStorage.createRecipe(parsed);
      broadcast(wss, "INV_RECIPE_CREATED", recipe);
      res.json(recipe);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/recipes/:id", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const recipe = await invStorage.updateRecipe(parseInt(req.params.id), req.body);
      if (!recipe) return res.status(404).json({ message: "Receta no encontrada" });
      broadcast(wss, "INV_RECIPE_UPDATED", recipe);
      res.json(recipe);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/inv/recipes/:id/lines", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      res.json(await invStorage.getRecipeLines(parseInt(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/recipe-lines", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const parsed = insertInvRecipeLineSchema.parse(req.body);
      const line = await invStorage.createRecipeLine(parsed);
      broadcast(wss, "INV_RECIPE_LINE_CREATED", line);
      res.json(line);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/recipe-lines/:id", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const line = await invStorage.updateRecipeLine(parseInt(req.params.id), req.body);
      if (!line) return res.status(404).json({ message: "Línea de receta no encontrada" });
      broadcast(wss, "INV_RECIPE_LINE_UPDATED", line);
      res.json(line);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/recipe-lines/:id", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      await invStorage.deleteRecipeLine(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/inv/products/:id/inventory-control", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "El campo 'enabled' es requerido y debe ser boolean" });
      }
      const product = await invStorage.toggleProductInventoryControl(parseInt(req.params.id), enabled);
      if (!product) return res.status(404).json({ message: "Producto no encontrado" });
      broadcast(wss, "INV_PRODUCT_INVENTORY_TOGGLED", product);
      res.json(product);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/inv/reports/value", requirePermission("INV_VIEW_REPORTS"), async (_req, res) => {
    try {
      res.json(await invStorage.getInventoryValueReport());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/reports/low-stock", requirePermission("INV_VIEW_REPORTS"), async (_req, res) => {
    try {
      const items = await db.select().from(invItems)
        .where(and(
          eq(invItems.isActive, true),
          lt(invItems.onHandQtyBase, invItems.reorderPointQtyBase)
        ))
        .orderBy(asc(invItems.name));
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
