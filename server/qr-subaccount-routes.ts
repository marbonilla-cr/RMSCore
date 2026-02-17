import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import * as storage from "./storage";
import * as invStorage from "./inventory-storage";
import {
  orderSubaccounts, orderItems, qrSubmissions, orders, tables,
  businessConfig, products, categories, orderItemModifiers,
  modifierOptions, salesLedgerItems, kitchenTickets, kitchenTicketItems,
  type OrderSubaccount,
} from "@shared/schema";
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";

const MAX_PENDING_QR_REQUESTS = 8;

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

function getBusinessDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

function extractTableNumber(tableName: string): string {
  const match = tableName.match(/(\d+)/);
  return match ? match[1] : "0";
}

async function getOrCreateOrderForTable(tableId: number) {
  let order = await storage.getOpenOrderForTable(tableId);
  if (order) return order;
  try {
    order = await storage.createOrder({
      tableId,
      status: "OPEN",
      responsibleWaiterId: null,
      businessDate: getBusinessDate(),
    });
  } catch (e: any) {
    order = await storage.getOpenOrderForTable(tableId);
    if (order) return order;
    throw e;
  }
  return order;
}

async function getMaxSubaccounts(): Promise<number> {
  const config = await storage.getBusinessConfig();
  return (config as any)?.maxSubaccounts ?? 6;
}

export function registerQrSubaccountRoutes(app: Express, broadcast: (type: string, payload: any) => void) {

  app.get("/api/qr/:tableCode/subaccounts", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const table = await storage.getTableByCode(tableCode);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await storage.getOpenOrderForTable(table.id);
      if (!order) return res.json([]);

      const subs = await db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)))
        .orderBy(asc(orderSubaccounts.slotNumber));

      res.json(subs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/subaccounts", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const { label, slotNumber: requestedSlot } = req.body || {};

      const table = await storage.getTableByCode(tableCode);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await getOrCreateOrderForTable(table.id);
      const maxSubs = await getMaxSubaccounts();

      const existing = await db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)));

      const usedSlots = new Set(existing.map(s => s.slotNumber));

      if (requestedSlot) {
        const slot = Number(requestedSlot);
        if (slot < 1 || slot > maxSubs) {
          return res.status(400).json({ message: `Subcuenta ${slot} no es válida. Máximo: ${maxSubs}` });
        }
        if (usedSlots.has(slot)) {
          const found = existing.find(s => s.slotNumber === slot);
          if (found) return res.json(found);
        }
      }

      if (existing.length >= maxSubs) {
        return res.status(400).json({ message: `Máximo ${maxSubs} subcuentas permitidas` });
      }

      let slotNumber = requestedSlot ? Number(requestedSlot) : 1;
      if (!requestedSlot) {
        while (usedSlots.has(slotNumber) && slotNumber <= maxSubs) slotNumber++;
      }

      const tableNumber = extractTableNumber(table.tableName);
      const code = `${tableNumber}-${slotNumber}`;

      const [subaccount] = await db.insert(orderSubaccounts).values({
        orderId: order.id,
        tableId: table.id,
        slotNumber,
        code,
        label: label || null,
        isActive: true,
      }).returning();

      res.json(subaccount);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/subaccounts-batch", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const { count } = req.body || {};

      const table = await storage.getTableByCode(tableCode);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await getOrCreateOrderForTable(table.id);
      const maxSubs = await getMaxSubaccounts();
      const wanted = Math.min(Math.max(Number(count) || 2, 1), maxSubs);

      const existing = await db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)));

      if (existing.length >= wanted) {
        return res.json(existing.sort((a: any, b: any) => a.slotNumber - b.slotNumber).slice(0, wanted));
      }

      const toCreate = Math.min(wanted - existing.length, maxSubs - existing.length);
      if (toCreate <= 0) {
        return res.json(existing);
      }

      const usedSlots = new Set(existing.map(s => s.slotNumber));
      const tableNumber = extractTableNumber(table.tableName);
      const created: any[] = [];

      for (let i = 0; i < toCreate; i++) {
        let slotNumber = 1;
        while (usedSlots.has(slotNumber) && slotNumber <= maxSubs) slotNumber++;
        usedSlots.add(slotNumber);
        const code = `${tableNumber}-${slotNumber}`;
        const [sub] = await db.insert(orderSubaccounts).values({
          orderId: order.id,
          tableId: table.id,
          slotNumber,
          code,
          label: `Cuenta ${slotNumber}`,
          isActive: true,
        }).returning();
        created.push(sub);
      }

      res.json([...existing, ...created]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/submit-v2", async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;
      const { subaccountId, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items requeridos" });
      }

      const table = await storage.getTableByCode(tableCode);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const pendingCount = await db.select({ count: sql<number>`count(*)` })
        .from(qrSubmissions)
        .where(and(
          eq(qrSubmissions.tableId, table.id),
          inArray(qrSubmissions.status, ["PENDING", "SUBMITTED"])
        ));

      if ((pendingCount[0]?.count || 0) >= MAX_PENDING_QR_REQUESTS) {
        return res.status(429).json({ message: "Demasiados pedidos pendientes. Espere a que sean procesados." });
      }

      const order = await getOrCreateOrderForTable(table.id);

      const [sub] = await db.insert(qrSubmissions).values({
        orderId: order.id,
        tableId: table.id,
        status: "SUBMITTED",
      }).returning();

      await db.update(qrSubmissions).set({
        payloadSnapshot: { subaccountId, items },
      } as any).where(eq(qrSubmissions.id, sub.id));

      broadcast("qr_submission", { tableId: table.id, submissionId: sub.id });

      res.json({ submissionId: sub.id, message: "Pedido enviado" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/waiter/qr-submissions/:id/accept-v2", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id as string);
      const userId = req.session.userId!;

      const sub = await storage.getSubmission(subId);
      if (!sub || sub.status !== "SUBMITTED") {
        return res.status(400).json({ message: "Submission no válida o ya procesada" });
      }

      const order = await storage.getOrder(sub.orderId);
      if (!order) return res.status(400).json({ message: "Orden no encontrada" });

      const table = await storage.getTable(sub.tableId);
      if (!table) return res.status(400).json({ message: "Mesa no encontrada" });

      if (!order.responsibleWaiterId) {
        await storage.updateOrder(order.id, { responsibleWaiterId: userId });
      }

      const payload = sub.payloadSnapshot as any;
      if (!payload || !payload.items || !Array.isArray(payload.items)) {
        return res.status(400).json({ message: "Payload inválido" });
      }

      const payloadItems = payload.items as Array<{
        productId: number;
        qty: number;
        customerName?: string;
        modifiers?: Array<{ modGroupId: number; optionId: number }>;
        notes?: string;
      }>;

      let subaccount: OrderSubaccount | null = null;
      if (payload.subaccountId) {
        const [sa] = await db.select().from(orderSubaccounts)
          .where(eq(orderSubaccounts.id, payload.subaccountId));
        subaccount = sa || null;
      }

      const existingItems = await storage.getOrderItems(order.id);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const allCategories = await storage.getAllCategories();
      const allTaxCats = await storage.getAllTaxCategories();
      const createdItems: any[] = [];

      for (const item of payloadItems) {
        const product = await storage.getProduct(item.productId);
        if (!product || !product.active) continue;

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
          responsibleWaiterId: userId,
          status: "PENDING",
          roundNumber,
          qrSubmissionId: subId,
        });

        await db.update(orderItems).set({
          subaccountId: subaccount?.id || null,
          subaccountCodeSnapshot: subaccount?.code || null,
          customerNameSnapshot: item.customerName || null,
        }).where(eq(orderItems.id, orderItem.id));

        const taxLinks = await storage.getProductTaxCategories(product.id);
        if (taxLinks.length > 0) {
          const taxSnapshot = taxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot });
          }
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const mod of item.modifiers) {
            const [option] = await db.select().from(modifierOptions)
              .where(eq(modifierOptions.id, mod.optionId));
            if (option) {
              await storage.createOrderItemModifier({
                orderItemId: orderItem.id,
                modifierOptionId: mod.optionId,
                nameSnapshot: option.name,
                priceDeltaSnapshot: option.priceDelta || "0",
                qty: 1,
              });
            }
          }
        }

        const itemMods = item.modifiers || [];
        let modDelta = 0;
        for (const mod of itemMods) {
          const [option] = await db.select().from(modifierOptions)
            .where(eq(modifierOptions.id, mod.optionId));
          if (option) modDelta += Number(option.priceDelta || 0);
        }
        const unitWithMods = Number(product.price) + modDelta;

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
          unitPrice: unitWithMods.toFixed(2),
          lineSubtotal: (unitWithMods * item.qty).toFixed(2),
          origin: "QR",
          createdByUserId: null,
          responsibleWaiterId: userId,
          status: "OPEN",
        });

        createdItems.push({ ...orderItem, productName: product.name });
      }

      await storage.updateSubmission(subId, {
        status: "ACCEPTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      });

      const createdTicketIds: number[] = [];
      if (createdItems.length > 0) {
        const kdsTickets: Map<string, number> = new Map();

        for (const createdItem of createdItems) {
          const product = await storage.getProduct(createdItem.productId);
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

          await storage.updateOrderItem(createdItem.id, {
            status: "SENT",
            sentToKitchenAt: new Date(),
          });

          await storage.createKitchenTicketItem({
            kitchenTicketId: ticketId,
            orderItemId: createdItem.id,
            productNameSnapshot: createdItem.productNameSnapshot,
            qty: createdItem.qty,
            notes: createdItem.notes,
            status: "NEW",
          });

          try { await invStorage.consumeForOrderItem(createdItem.id, createdItem.productId, createdItem.qty, userId); } catch (e) { console.error("[inv] consumption error:", e); }
          await storage.decrementPortions(createdItem.productId, createdItem.qty);

          await storage.updateSalesLedgerItems(createdItem.id, {
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          });
        }

        await storage.updateOrder(order.id, { status: "IN_KITCHEN" });
      }

      await storage.recalcOrderTotal(order.id);

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "WAITER_ACCEPTED_QR_V2",
        entityType: "qr_submission",
        entityId: subId,
        tableId: sub.tableId,
        metadata: { itemCount: createdItems.length, submissionId: subId },
      });

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId: sub.tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId: sub.tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId: sub.tableId });

      const updatedOrder = await storage.getOpenOrderForTable(sub.tableId);
      const updatedItems = updatedOrder ? await storage.getOrderItems(updatedOrder.id) : [];

      res.json({
        ok: true,
        ticketIds: createdTicketIds,
        table,
        activeOrder: updatedOrder,
        orderItems: updatedItems,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/waiter/qr-submissions/:id/reject", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id as string);
      const userId = req.session.userId!;

      const sub = await storage.getSubmission(subId);
      if (!sub || sub.status !== "SUBMITTED") {
        return res.status(400).json({ message: "Submission no válida o ya procesada" });
      }

      await storage.updateSubmission(subId, {
        status: "REJECTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      });

      await storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "WAITER_REJECTED_QR",
        entityType: "qr_submission",
        entityId: subId,
        tableId: sub.tableId,
        metadata: { submissionId: subId },
      });

      broadcast("order_updated", { tableId: sub.tableId, orderId: sub.orderId });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/waiter/tables/:tableId/qr-pending", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const tableId = parseInt(req.params.tableId as string);

      const submissions = await db.select().from(qrSubmissions)
        .where(and(
          eq(qrSubmissions.tableId, tableId),
          eq(qrSubmissions.status, "SUBMITTED")
        ))
        .orderBy(asc(qrSubmissions.createdAt));

      const result = submissions.map(s => ({
        ...s,
        payload: s.payloadSnapshot || null,
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/waiter/orders/:orderId/by-subaccount", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);

      const items = await storage.getOrderItems(orderId);

      const subaccountIds = Array.from(new Set(items.map(i => (i as any).subaccountId).filter(Boolean)));
      let subaccountsMap: Map<number, OrderSubaccount> = new Map();

      if (subaccountIds.length > 0) {
        const subs = await db.select().from(orderSubaccounts)
          .where(inArray(orderSubaccounts.id, subaccountIds));
        for (const s of subs) subaccountsMap.set(s.id, s);
      }

      const itemIds = items.map(i => i.id);
      let modsMap: Map<number, any[]> = new Map();
      if (itemIds.length > 0) {
        const allMods = await db.select().from(orderItemModifiers)
          .where(inArray(orderItemModifiers.orderItemId, itemIds));
        for (const m of allMods) {
          if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []);
          modsMap.get(m.orderItemId)!.push(m);
        }
      }

      const groups: Record<string, { subaccount: OrderSubaccount | null; items: any[] }> = {};

      for (const item of items) {
        const saId = (item as any).subaccountId;
        const key = saId ? String(saId) : "none";
        if (!groups[key]) {
          groups[key] = {
            subaccount: saId ? subaccountsMap.get(saId) || null : null,
            items: [],
          };
        }
        groups[key].items.push({
          ...item,
          modifiers: modsMap.get(item.id) || [],
        });
      }

      res.json({ groups: Object.values(groups) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pos/orders/:orderId/splits-from-subaccounts", requireRole("CASHIER", "MANAGER"), async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId as string);

      const subs = await db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, orderId), eq(orderSubaccounts.isActive, true)));
      if (subs.length === 0) return res.status(400).json({ message: "No hay subcuentas para esta orden" });

      const allItems = await storage.getOrderItems(orderId);
      const activeItems = allItems.filter((i: any) => i.status !== "VOIDED");

      const existingSplits = await storage.getSplitAccountsForOrder(orderId);
      for (const s of existingSplits) {
        await storage.deleteSplitAccount(s.id);
      }

      const result: any[] = [];
      for (const sub of subs) {
        const subItems = activeItems.filter((i: any) => (i as any).subaccountId === sub.id);
        if (subItems.length === 0) continue;

        const split = await storage.createSplitAccount({ orderId, label: `Mesa ${sub.code}` });
        for (const item of subItems) {
          await storage.createSplitItem({ splitId: split.id, orderItemId: item.id });
        }
        const items = await storage.getSplitItemsForSplit(split.id);
        result.push({ ...split, items });
      }

      const unassignedItems = activeItems.filter((i: any) => !(i as any).subaccountId || !subs.find(s => s.id === (i as any).subaccountId));
      if (unassignedItems.length > 0) {
        const split = await storage.createSplitAccount({ orderId, label: "Sin subcuenta" });
        for (const item of unassignedItems) {
          await storage.createSplitItem({ splitId: split.id, orderItemId: item.id });
        }
        const items = await storage.getSplitItemsForSplit(split.id);
        result.push({ ...split, items });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
