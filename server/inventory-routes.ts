import type { Express, Request, Response, NextFunction } from "express";
import { WebSocket } from "ws";
import * as invStorage from "./inventory-storage";
import * as storage from "./storage";
import { normalizeUom } from "./uom-helpers";
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
import { invItems, products } from "@shared/schema";
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
  app.get("/api/inv/products", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      const allProducts = await db.select().from(products).orderBy(asc(products.name));
      res.json(allProducts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/items", requirePermission("INV_VIEW"), async (req, res) => {
    try {
      const typeFilter = req.query.type as string | undefined;
      if (typeFilter && (typeFilter === "AP" || typeFilter === "EP")) {
        const items = await db.select().from(invItems)
          .where(eq(invItems.itemType, typeFilter))
          .orderBy(asc(invItems.name));
        return res.json(items);
      }
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

  function coerceNumericFields(body: any) {
    const numericKeys = [
      "onHandQtyBase", "reorderPointQtyBase", "parLevelQtyBase",
      "avgCostPerBaseUom", "lastCostPerBaseUom", "unitWeightG",
    ];
    const out = { ...body };
    for (const k of numericKeys) {
      if (k in out && out[k] != null) {
        out[k] = String(out[k]);
      }
    }
    return out;
  }

  app.post("/api/inv/items", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const parsed = insertInvItemSchema.parse(coerceNumericFields(req.body));
      const item = await invStorage.createInvItem(parsed);
      broadcast(wss, "INV_ITEM_CREATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/items/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const coerced = coerceNumericFields(req.body);
      const item = await invStorage.updateInvItem(parseInt(req.params.id), coerced);
      if (!item) return res.status(404).json({ message: "Item no encontrado" });
      broadcast(wss, "INV_ITEM_UPDATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/items/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const result = await invStorage.smartDeleteInvItem(parseInt(req.params.id));
      if (!result.item) return res.status(404).json({ message: "Item no encontrado" });
      broadcast(wss, "INV_ITEM_DELETED", result.item);
      res.json({ item: result.item, hardDeleted: result.hardDeleted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/items/bulk-import", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const { items: importItems } = req.body;
      if (!Array.isArray(importItems) || importItems.length === 0) {
        return res.status(400).json({ message: "Se requiere un array de items" });
      }
      if (importItems.length > 500) {
        return res.status(400).json({ message: "Máximo 500 items por importación" });
      }
      
      const results: { created: number; skipped: number; errors: string[] } = { created: 0, skipped: 0, errors: [] };
      
      for (const item of importItems) {
        try {
          const sku = String(item.sku || "").trim().toUpperCase();
          const name = String(item.name || "").trim();
          if (!sku || !name) {
            results.errors.push(`Item sin SKU o nombre: ${JSON.stringify(item).slice(0, 100)}`);
            results.skipped++;
            continue;
          }
          const existing = await invStorage.getInvItemBySku(sku);
          if (existing) {
            results.skipped++;
            continue;
          }
          const parsed = insertInvItemSchema.parse({
            sku,
            name,
            category: item.category || "General",
            baseUom: item.baseUom || "UNIT",
            onHandQtyBase: item.onHandQtyBase || "0",
            reorderPointQtyBase: item.reorderPointQtyBase || "0",
            parLevelQtyBase: item.parLevelQtyBase || "0",
            isPerishable: item.isPerishable || false,
            notes: item.notes || null,
          });
          await invStorage.createInvItem(parsed);
          results.created++;
        } catch (itemErr: any) {
          results.errors.push(`SKU ${item.sku}: ${itemErr.message}`);
          results.skipped++;
        }
      }
      
      res.json(results);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/items/quick-ep", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const { name, baseUom } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Nombre es requerido" });
      }
      if (!baseUom || typeof baseUom !== "string" || !baseUom.trim()) {
        return res.status(400).json({ message: "UOM es requerida" });
      }
      let normalizedUom: string;
      try {
        normalizedUom = normalizeUom(baseUom);
      } catch (e: any) {
        return res.status(400).json({ message: e.message });
      }
      const sku = `EP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const item = await invStorage.createInvItem({
        sku,
        name: name.trim(),
        itemType: "EP",
        category: "EP",
        baseUom: normalizedUom,
        isActive: true,
        onHandQtyBase: "0",
        reorderPointQtyBase: "0",
        parLevelQtyBase: "0",
        isPerishable: false,
      });
      broadcast(wss, "INV_ITEM_CREATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/items/quick-ap", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const { name, baseUom, lastCostPerBaseUom } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Nombre es requerido" });
      }
      if (!baseUom || typeof baseUom !== "string" || !baseUom.trim()) {
        return res.status(400).json({ message: "UOM es requerida" });
      }
      let normalizedUom: string;
      try {
        normalizedUom = normalizeUom(baseUom);
      } catch (e: any) {
        return res.status(400).json({ message: e.message });
      }
      const cost = lastCostPerBaseUom != null ? String(lastCostPerBaseUom) : "0";
      const sku = `AP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const item = await invStorage.createInvItem({
        sku,
        name: name.trim(),
        itemType: "AP",
        category: "AP",
        baseUom: normalizedUom,
        isActive: true,
        onHandQtyBase: "0",
        reorderPointQtyBase: "0",
        parLevelQtyBase: "0",
        lastCostPerBaseUom: cost,
        avgCostPerBaseUom: "0",
        isPerishable: false,
      });
      broadcast(wss, "INV_ITEM_CREATED", item);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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

  app.get("/api/inv/purchase-orders/suggestions", requirePermission("INV_MANAGE_PO"), async (_req, res) => {
    try {
      res.json(await invStorage.getReorderSuggestions());
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
      const { invItemId, qtyPurchaseUom, purchaseUom, unitPricePerPurchaseUom } = req.body;

      if (!invItemId || !purchaseUom) {
        return res.status(400).json({ message: "Artículo y UOM son requeridos" });
      }

      const qtyNum = parseFloat(String(qtyPurchaseUom));
      const priceNum = parseFloat(String(unitPricePerPurchaseUom));
      if (isNaN(qtyNum) || qtyNum <= 0) {
        return res.status(400).json({ message: "Cantidad debe ser un número mayor a 0" });
      }
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({ message: "Precio debe ser un número válido" });
      }

      const uom = String(purchaseUom).trim();
      const itemId = parseInt(String(invItemId));
      const item = await invStorage.getInvItem(itemId);
      if (!item) {
        return res.status(404).json({ message: "Artículo de inventario no encontrado" });
      }

      let multiplier = "1";
      if (uom !== item.baseUom) {
        const conversions = await invStorage.getUomConversions(item.id);
        const conv = conversions.find((c: any) => c.fromUom === uom);
        if (!conv) {
          return res.status(400).json({ message: `No existe conversión de UOM '${uom}' a '${item.baseUom}'. Agregue la conversión primero en el detalle del insumo.` });
        }
        multiplier = conv.multiplier;
      }

      const qtyBaseExpected = String(qtyNum * parseFloat(multiplier));

      const parsed = insertInvPurchaseOrderLineSchema.parse({
        purchaseOrderId: parseInt(req.params.id),
        invItemId: itemId,
        qtyPurchaseUom: String(qtyNum),
        purchaseUom: uom,
        unitPricePerPurchaseUom: String(priceNum),
        toBaseMultiplierSnapshot: multiplier,
        qtyBaseExpected,
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

  app.get("/api/inv/recipes", requirePermission("INV_MANAGE_RECIPES"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllRecipesWithDetails());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/recipes/product/:productId", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const recipe = await invStorage.getActiveRecipeWithLines(parseInt(req.params.productId));
      res.json(recipe);
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
      const { lines, ...recipeData } = req.body;
      if (lines && Array.isArray(lines) && lines.length > 0) {
        const parsed = insertInvRecipeSchema.parse(recipeData);
        const recipe = await invStorage.createRecipeWithLines(parsed, lines);
        broadcast(wss, "INV_RECIPE_CREATED", recipe);
        res.json(recipe);
      } else {
        const parsed = insertInvRecipeSchema.parse(recipeData);
        const recipe = await invStorage.createRecipe(parsed);
        broadcast(wss, "INV_RECIPE_CREATED", recipe);
        res.json(recipe);
      }
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

  app.delete("/api/inv/recipes/:id", requirePermission("INV_MANAGE_RECIPES"), async (req, res) => {
    try {
      const recipe = await invStorage.deactivateRecipe(parseInt(req.params.id));
      if (!recipe) return res.status(404).json({ message: "Receta no encontrada" });
      broadcast(wss, "INV_RECIPE_DEACTIVATED", recipe);
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

  // ==================== STOCK AP/EP ====================

  app.get("/api/inv/stock/ap", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getStockAp());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inv/stock/ep", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getStockEp());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/stock/ap/adjust", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { invItemId, qtyDelta, reason } = req.body;
      if (!invItemId || qtyDelta === undefined || qtyDelta === null) {
        return res.status(400).json({ message: "Se requiere invItemId y qtyDelta" });
      }
      const delta = Number(qtyDelta);
      if (isNaN(delta) || delta === 0) {
        return res.status(400).json({ message: "qtyDelta debe ser un número diferente de 0" });
      }

      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO inv_stock_ap (inv_item_id, location_id, organization_id, qty_on_hand) 
           VALUES ($1, 1, 1, 0) ON CONFLICT DO NOTHING`,
          [invItemId]
        );
        const lockRes = await client.query(
          `SELECT qty_on_hand FROM inv_stock_ap WHERE organization_id=1 AND location_id=1 AND inv_item_id=$1 FOR UPDATE`,
          [invItemId]
        );
        const currentQty = Number(lockRes.rows[0].qty_on_hand);
        const newQty = currentQty + delta;
        if (newQty < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: `Stock insuficiente. Actual: ${currentQty}, ajuste: ${delta}` });
        }
        await client.query(
          `UPDATE inv_stock_ap SET qty_on_hand = $1, updated_at = NOW() WHERE organization_id=1 AND location_id=1 AND inv_item_id=$2`,
          [newQty.toFixed(4), invItemId]
        );
        const businessDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
        await client.query(
          `INSERT INTO inv_movements (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, note, created_by_employee_id)
           VALUES ($1, 'ADJUST_AP', $2, 'AP', $3, 'MANUAL', $4, $5)`,
          [businessDate, invItemId, delta.toFixed(4), reason || null, user.id]
        );
        await client.query("COMMIT");
        res.json({ ok: true, newQty: newQty.toFixed(4) });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/inv/stock/ep/adjust", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { invItemId, qtyDelta, reason } = req.body;
      if (!invItemId || qtyDelta === undefined || qtyDelta === null) {
        return res.status(400).json({ message: "Se requiere invItemId y qtyDelta" });
      }
      const delta = Number(qtyDelta);
      if (isNaN(delta) || delta === 0) {
        return res.status(400).json({ message: "qtyDelta debe ser un número diferente de 0" });
      }

      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO inv_stock_ep (inv_item_id, location_id, organization_id, qty_on_hand) 
           VALUES ($1, 1, 1, 0) ON CONFLICT DO NOTHING`,
          [invItemId]
        );
        const lockRes = await client.query(
          `SELECT qty_on_hand FROM inv_stock_ep WHERE organization_id=1 AND location_id=1 AND inv_item_id=$1 FOR UPDATE`,
          [invItemId]
        );
        const currentQty = Number(lockRes.rows[0].qty_on_hand);
        const newQty = currentQty + delta;
        if (newQty < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: `Stock insuficiente. Actual: ${currentQty}, ajuste: ${delta}` });
        }
        await client.query(
          `UPDATE inv_stock_ep SET qty_on_hand = $1, updated_at = NOW() WHERE organization_id=1 AND location_id=1 AND inv_item_id=$2`,
          [newQty.toFixed(4), invItemId]
        );
        const businessDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
        await client.query(
          `INSERT INTO inv_movements (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, note, created_by_employee_id)
           VALUES ($1, 'ADJUST_EP', $2, 'EP', $3, 'MANUAL', $4, $5)`,
          [businessDate, invItemId, delta.toFixed(4), reason || null, user.id]
        );
        await client.query("COMMIT");
        res.json({ ok: true, newQty: newQty.toFixed(4) });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== PRODUCTION BATCHES ====================

  app.get("/api/inv/production-batches", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllProductionBatches());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/production-batches", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { conversionId, apQtyUsed } = req.body;
      if (!conversionId || !apQtyUsed) {
        return res.status(400).json({ message: "Se requiere conversionId y apQtyUsed" });
      }
      const apQty = Number(apQtyUsed);
      if (isNaN(apQty) || apQty <= 0) {
        return res.status(400).json({ message: "apQtyUsed debe ser un número mayor a 0" });
      }

      const conversion = await invStorage.getConversion(conversionId);
      if (!conversion) {
        return res.status(404).json({ message: "Conversión no encontrada" });
      }

      const mermaPct = Number(conversion.mermaPct);
      const cookFactor = Number(conversion.cookFactor);
      const extraLossPct = Number(conversion.extraLossPct);
      const usableQty = apQty * (1 - mermaPct / 100) * cookFactor * (1 - extraLossPct / 100);

      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO inv_stock_ap (inv_item_id, location_id, organization_id, qty_on_hand) 
           VALUES ($1, 1, 1, 0) ON CONFLICT DO NOTHING`,
          [conversion.apItemId]
        );

        const apLock = await client.query(
          `SELECT qty_on_hand FROM inv_stock_ap WHERE organization_id=1 AND location_id=1 AND inv_item_id=$1 FOR UPDATE`,
          [conversion.apItemId]
        );
        const apStock = Number(apLock.rows[0].qty_on_hand);
        if (apStock < apQty) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: `Stock AP insuficiente. Disponible: ${apStock.toFixed(4)}, requerido: ${apQty.toFixed(4)}` });
        }

        await client.query(
          `UPDATE inv_stock_ap SET qty_on_hand = qty_on_hand - $1, updated_at = NOW() WHERE organization_id=1 AND location_id=1 AND inv_item_id=$2`,
          [apQty.toFixed(4), conversion.apItemId]
        );

        const batchRes = await client.query(
          `INSERT INTO production_batches (conversion_id, ap_item_id, ap_qty_used, location_id, organization_id, status, created_by_user_id)
           VALUES ($1, $2, $3, 1, 1, 'COMPLETED', $4) RETURNING id`,
          [conversionId, conversion.apItemId, apQty.toFixed(4), user.id]
        );
        const batchId = batchRes.rows[0].id;

        const businessDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
        await client.query(
          `INSERT INTO inv_movements (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, reference_id, created_by_employee_id)
           VALUES ($1, 'CONSUME_AP', $2, 'AP', $3, 'BATCH', $4, $5)`,
          [businessDate, conversion.apItemId, (-apQty).toFixed(4), String(batchId), user.id]
        );

        const epOutputs = conversion.outputs.sort((a: any, b: any) => a.epItemId - b.epItemId);

        for (const output of epOutputs) {
          const qtyEp = usableQty * (Number(output.outputPct) / 100);

          await client.query(
            `INSERT INTO inv_stock_ep (inv_item_id, location_id, organization_id, qty_on_hand) 
             VALUES ($1, 1, 1, 0) ON CONFLICT DO NOTHING`,
            [output.epItemId]
          );

          await client.query(
            `SELECT qty_on_hand FROM inv_stock_ep WHERE organization_id=1 AND location_id=1 AND inv_item_id=$1 FOR UPDATE`,
            [output.epItemId]
          );

          await client.query(
            `UPDATE inv_stock_ep SET qty_on_hand = qty_on_hand + $1, updated_at = NOW() WHERE organization_id=1 AND location_id=1 AND inv_item_id=$2`,
            [qtyEp.toFixed(4), output.epItemId]
          );

          await client.query(
            `INSERT INTO production_batch_outputs (batch_id, ep_item_id, qty_ep_generated)
             VALUES ($1, $2, $3)`,
            [batchId, output.epItemId, qtyEp.toFixed(4)]
          );

          await client.query(
            `INSERT INTO inv_movements (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, reference_id, created_by_employee_id)
             VALUES ($1, 'PRODUCE_EP', $2, 'EP', $3, 'BATCH', $4, $5)`,
            [businessDate, output.epItemId, qtyEp.toFixed(4), String(batchId), user.id]
          );
        }

        await client.query("COMMIT");
        res.json({ ok: true, batchId });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ==================== CONVERSIONS ====================

  app.get("/api/inv/conversions", requirePermission("INV_VIEW"), async (_req, res) => {
    try {
      res.json(await invStorage.getAllConversions());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inv/conversions", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const { apItemId, name, mermaPct, cookFactor, extraLossPct, notes, outputs } = req.body;
      if (!apItemId || !name) {
        return res.status(400).json({ message: "Se requiere apItemId y nombre" });
      }
      if (!Array.isArray(outputs) || outputs.length === 0) {
        return res.status(400).json({ message: "Se requiere al menos una salida EP" });
      }
      const totalPct = outputs.reduce((sum: number, o: any) => sum + Number(o.outputPct || 100), 0);
      if (totalPct > 100) {
        return res.status(400).json({ message: `La suma de outputPct (${totalPct}%) excede 100%` });
      }
      if (outputs.length === 1 && (outputs[0].outputPct === undefined || outputs[0].outputPct === null)) {
        outputs[0].outputPct = "100";
      }
      const conv = await invStorage.createConversion({
        apItemId,
        name,
        mermaPct: mermaPct || "0",
        cookFactor: cookFactor || "1",
        extraLossPct: extraLossPct || "0",
        notes: notes || null,
        outputs,
      });
      broadcast(wss, "INV_CONVERSION_CREATED", conv);
      res.json(conv);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inv/conversions/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const { outputs, ...header } = req.body;
      if (outputs !== undefined) {
        if (!Array.isArray(outputs) || outputs.length === 0) {
          return res.status(400).json({ message: "Se requiere al menos una salida EP" });
        }
        const totalPct = outputs.reduce((sum: number, o: any) => sum + Number(o.outputPct || 100), 0);
        if (totalPct > 100) {
          return res.status(400).json({ message: `La suma de outputPct (${totalPct}%) excede 100%` });
        }
      }
      const conv = await invStorage.updateConversion(parseInt(req.params.id), { ...header, outputs });
      if (!conv) return res.status(404).json({ message: "Conversión no encontrada" });
      broadcast(wss, "INV_CONVERSION_UPDATED", conv);
      res.json(conv);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inv/conversions/:id", requirePermission("INV_MANAGE_ITEMS"), async (req, res) => {
    try {
      const conv = await invStorage.deactivateConversion(parseInt(req.params.id));
      if (!conv) return res.status(404).json({ message: "Conversión no encontrada" });
      broadcast(wss, "INV_CONVERSION_DEACTIVATED", conv);
      res.json(conv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
