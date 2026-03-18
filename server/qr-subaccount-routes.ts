import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "./db";
import * as storage from "./storage";
import * as invStorage from "./inventory-storage";
import { onOrderItemsConfirmedSent, onOrderItemsVoided } from "./inventory-deduction";
import { generateTransactionCode } from "./utils/transaction-code";
import {
  orderSubaccounts, orderItems, qrSubmissions, orders, tables,
  businessConfig, products, categories, orderItemModifiers,
  modifierOptions, salesLedgerItems, kitchenTickets, kitchenTicketItems,
  orderReviews,
  type OrderSubaccount,
} from "@shared/schema";
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { isDispatchEnabled } from "./middleware/dispatch";

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

async function getBusinessDate(schema?: string): Promise<string> {
  const { getTenantTimezone, getBusinessDateInTZ } = await import("./utils/timezone");
  const tz = await getTenantTimezone(schema || process.env.TENANT_SCHEMA || "public");
  return getBusinessDateInTZ(tz);
}

function extractTableNumber(tableName: string): string {
  const match = tableName.match(/(\d+)/);
  return match ? match[1] : "0";
}

async function getOrCreateOrderForTable(tableId: number, dbInstance?: typeof db) {
  let order = await storage.getOpenOrderForTable(tableId, dbInstance);
  if (order) return order;
  try {
    order = await storage.createOrder({
      tableId,
      status: "OPEN",
      responsibleWaiterId: null,
      businessDate: await getBusinessDate(),
    }, dbInstance);
  } catch (e: any) {
    order = await storage.getOpenOrderForTable(tableId, dbInstance);
    if (order) return order;
    throw e;
  }
  return order;
}



async function handleDirectDispatchSubmit(
  req: Request,
  res: Response,
  subaccountId: number | null,
  items: any[],
  broadcastFn: (type: string, payload: any) => void
): Promise<void> {
  const businessDate = await getBusinessDate((req as any).tenantSchema);
  const txCode = await generateTransactionCode(req.db, businessDate);

  const [order] = await req.db.insert(orders).values({
    tableId: null,
    status: "OPEN",
    responsibleWaiterId: null,
    businessDate,
    transactionCode: txCode,
    orderMode: "DISPATCH",
    dispatchStatus: "PENDING_PAYMENT",
  } as any).returning();

  const uniqueProductIds = Array.from(new Set(items.map((i: any) => Number(i.productId))));
  const allModOptionIds = Array.from(new Set(
    items.flatMap((i: any) => (i.modifiers || []).map((m: any) => Number(m.optionId)))
  ));

  const [productsArr, modOptionsArr, allCategories, allTaxCats] = await Promise.all([
    uniqueProductIds.length > 0
      ? req.db.select().from(products).where(inArray(products.id, uniqueProductIds))
      : Promise.resolve([]),
    allModOptionIds.length > 0
      ? req.db.select().from(modifierOptions).where(inArray(modifierOptions.id, allModOptionIds))
      : Promise.resolve([]),
    storage.getAllCategories(req.db),
    storage.getAllTaxCategories(req.db),
  ]);

  const productsMap = new Map(productsArr.map((p: any) => [p.id, p]));
  const modOptionsMap = new Map(modOptionsArr.map((o: any) => [o.id, o]));

  const roundNumber = 1;

  for (const item of items) {
    const product = productsMap.get(Number(item.productId));
    if (!product || !(product as any).active) continue;

    const category = allCategories.find((c: any) => c.id === (product as any).categoryId);

    const orderItem = await storage.createOrderItem({
      orderId: order.id,
      productId: (product as any).id,
      productNameSnapshot: (product as any).name,
      productPriceSnapshot: (product as any).price,
      qty: item.qty,
      notes: item.notes || null,
      origin: "QR",
      createdByUserId: null,
      responsibleWaiterId: null,
      status: "OPEN",
      roundNumber,
      qrSubmissionId: null,
    }, req.db);

    if (item.customerName) {
      await req.db.update(orderItems).set({
        customerNameSnapshot: item.customerName,
      }).where(eq(orderItems.id, orderItem.id));
    }

    const taxLinks = (await storage.getProductTaxCategories((product as any).id, req.db)) || [];
    if (taxLinks.length > 0) {
      const taxSnapshot = taxLinks.map((ptc: any) => {
        const tc = allTaxCats.find((t: any) => t.id === ptc.taxCategoryId && t.active);
        return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
      }).filter(Boolean);
      if (taxSnapshot.length > 0) {
        await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot }, req.db);
      }
    }

    if (item.modifiers && Array.isArray(item.modifiers)) {
      for (const mod of item.modifiers) {
        const option = modOptionsMap.get(Number(mod.optionId));
        if (option) {
          await storage.createOrderItemModifier({
            orderItemId: orderItem.id,
            modifierOptionId: (option as any).id,
            nameSnapshot: (option as any).name,
            priceDeltaSnapshot: (option as any).priceDelta || "0",
            qty: 1,
          }, req.db);
        }
      }
    }

    let modDelta = 0;
    for (const mod of (item.modifiers || [])) {
      const option = modOptionsMap.get(Number(mod.optionId));
      if (option) modDelta += Number((option as any).priceDelta || 0);
    }
    const unitWithMods = Number((product as any).price) + modDelta;

    await storage.createSalesLedgerItem({
      businessDate,
      tableId: null,
      tableNameSnapshot: "Despacho",
      orderId: order.id,
      orderItemId: orderItem.id,
      productId: (product as any).id,
      productCodeSnapshot: (product as any).productCode,
      productNameSnapshot: (product as any).name,
      categoryId: (product as any).categoryId,
      categoryCodeSnapshot: (category as any)?.categoryCode || null,
      categoryNameSnapshot: (category as any)?.name || null,
      qty: item.qty,
      unitPrice: unitWithMods.toFixed(2),
      lineSubtotal: (unitWithMods * item.qty).toFixed(2),
      origin: "QR",
      createdByUserId: null,
      responsibleWaiterId: null,
      status: "OPEN",
    }, req.db);

  }

  await storage.recalcOrderTotal(order.id, req.db);

  broadcastFn("order_updated", { orderId: order.id });
  broadcastFn("table_status_changed", {});

  res.json({
    dispatch: true,
    transactionCode: txCode,
    orderId: order.id,
    message: "Pedido recibido. Mostrá tu código al cajero para pagar.",
  });
}

interface QrSecurityUtils {
  qrSubmitRateCheck: (req: Request, res: Response) => boolean;
  qrSubaccountRateCheck: (req: Request, res: Response) => boolean;
  generateQrDailyToken: (tableCode: string, date: string) => string;
  getBusinessDateCR: (schema?: string) => Promise<string>;
}

function validateQrToken(utils: QrSecurityUtils) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers["x-qr-token"] as string;
    const tableCode = req.params.tableCode as string;
    if (!token || !tableCode) {
      return res.status(403).json({ message: "Token de acceso requerido. Escanee el QR nuevamente." });
    }
    const today = await utils.getBusinessDateCR(req.tenantSchema);
    const expected = utils.generateQrDailyToken(tableCode, today);
    if (token !== expected) {
      return res.status(403).json({ message: "Token expirado. Escanee el QR nuevamente para obtener acceso." });
    }
    next();
  };
}

export function registerQrSubaccountRoutes(app: Express, broadcast: (type: string, payload: any) => void, security?: QrSecurityUtils) {

  const tokenCheck = security ? validateQrToken(security) : (_req: Request, _res: Response, next: NextFunction) => next();

  app.get("/api/qr/:tableCode/subaccounts", tokenCheck, async (req, res) => {
    try {
      const tableCode = req.params.tableCode as string;

      if (tableCode === "DISPATCH") {
        return res.json([]);
      }

      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await storage.getOpenOrderForTable(table.id, req.db);
      if (!order) return res.json([]);

      const subs = await req.db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)))
        .orderBy(asc(orderSubaccounts.slotNumber));

      res.json(subs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/subaccounts", tokenCheck, async (req, res) => {
    try {
      if (security && !security.qrSubaccountRateCheck(req, res)) return;
      const tableCode = req.params.tableCode as string;

      if (tableCode === "DISPATCH") {
        return res.status(400).json({ message: "Despacho no soporta subcuentas" });
      }

      const { label, slotNumber: requestedSlot } = req.body || {};

      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await getOrCreateOrderForTable(table.id, req.db);

      const existing = await req.db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)));

      if (label && typeof label === "string" && label.trim()) {
        const normalizedLabel = label.trim().toLowerCase();
        const matchByName = existing.find(s => s.label && s.label.trim().toLowerCase() === normalizedLabel);
        if (matchByName) {
          return res.status(409).json({ message: "Ese nombre ya está en uso en esta mesa. Por favor usá un nombre diferente.", existingLabel: matchByName.label });
        }
      }

      const usedSlots = new Set(existing.map(s => s.slotNumber));

      if (requestedSlot) {
        const slot = Number(requestedSlot);
        if (slot < 1) {
          return res.status(400).json({ message: `Número de subcuenta no válido` });
        }
        if (usedSlots.has(slot)) {
          const found = existing.find(s => s.slotNumber === slot);
          if (found) return res.json(found);
        }
      }

      let slotNumber = requestedSlot ? Number(requestedSlot) : 1;
      if (!requestedSlot) {
        while (usedSlots.has(slotNumber)) slotNumber++;
      }

      const tableNumber = extractTableNumber(table.tableName);
      const code = `${tableNumber}-${slotNumber}`;

      const [subaccount] = await req.db.insert(orderSubaccounts).values({
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

  app.post("/api/qr/:tableCode/subaccounts-batch", tokenCheck, async (req, res) => {
    try {
      if (security && !security.qrSubaccountRateCheck(req, res)) return;
      const tableCode = req.params.tableCode as string;

      if (tableCode === "DISPATCH") {
        return res.status(400).json({ message: "Despacho no soporta subcuentas" });
      }

      const { count } = req.body || {};

      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const order = await getOrCreateOrderForTable(table.id, req.db);
      const wanted = Math.max(Number(count) || 2, 1);

      const existing = await req.db.select().from(orderSubaccounts)
        .where(and(eq(orderSubaccounts.orderId, order.id), eq(orderSubaccounts.isActive, true)));

      if (existing.length >= wanted) {
        return res.json(existing.sort((a: any, b: any) => a.slotNumber - b.slotNumber).slice(0, wanted));
      }

      const toCreate = wanted - existing.length;

      const usedSlots = new Set(existing.map(s => s.slotNumber));
      const tableNumber = extractTableNumber(table.tableName);
      const created: any[] = [];

      for (let i = 0; i < toCreate; i++) {
        let slotNumber = 1;
        while (usedSlots.has(slotNumber)) slotNumber++;
        usedSlots.add(slotNumber);
        const code = `${tableNumber}-${slotNumber}`;
        const [sub] = await req.db.insert(orderSubaccounts).values({
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

  app.post("/api/qr/:tableCode/submit-v2", tokenCheck, async (req, res) => {
    try {
      if (security && !security.qrSubmitRateCheck(req, res)) return;
      const tableCode = req.params.tableCode as string;
      const { subaccountId, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items requeridos" });
      }

      if (tableCode === "DISPATCH") {
        const dispatchEnabled = await isDispatchEnabled(req.db);
        if (dispatchEnabled) {
          return handleDirectDispatchSubmit(req, res, subaccountId, items, broadcast);
        }
        // Dispatch disabled: fall through to normal QR flow using a virtual DISPATCH table row
        const inserted = await req.db
          .insert(tables)
          .values({ tableCode: "DISPATCH", tableName: "Despacho", active: false, sortOrder: -1 } as any)
          .onConflictDoNothing()
          .returning();
        const virtualTable = inserted[0] ?? (await storage.getTableByCode("DISPATCH", req.db));
        if (!virtualTable) {
          return res.status(404).json({ message: "Despacho no habilitado" });
        }
        const order = await getOrCreateOrderForTable(virtualTable.id, req.db);
        const [sub] = await req.db.insert(qrSubmissions).values({
          orderId: order.id,
          tableId: virtualTable.id,
          status: "SUBMITTED",
        }).returning();
        await req.db.update(qrSubmissions).set({ payloadSnapshot: { subaccountId, items } } as any).where(eq(qrSubmissions.id, sub.id));
        broadcast("qr_submission_created", { tableId: virtualTable.id, tableName: virtualTable.tableName, submissionId: sub.id, itemsCount: items.length });
        broadcast("qr_submission", { tableId: virtualTable.id, submissionId: sub.id });
        return res.json({ submissionId: sub.id, orderId: order.id, message: "Pedido enviado" });
      }

      const table = await storage.getTableByCode(tableCode, req.db);
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const pendingCount = await req.db.select({ count: sql<number>`count(*)` })
        .from(qrSubmissions)
        .where(and(
          eq(qrSubmissions.tableId, table.id),
          inArray(qrSubmissions.status, ["PENDING", "SUBMITTED"])
        ));

      if ((pendingCount[0]?.count || 0) >= MAX_PENDING_QR_REQUESTS) {
        return res.status(429).json({ message: "Demasiados pedidos pendientes. Espere a que sean procesados." });
      }

      const order = await getOrCreateOrderForTable(table.id, req.db);

      const [sub] = await req.db.insert(qrSubmissions).values({
        orderId: order.id,
        tableId: table.id,
        status: "SUBMITTED",
      }).returning();

      await req.db.update(qrSubmissions).set({
        payloadSnapshot: { subaccountId, items },
      } as any).where(eq(qrSubmissions.id, sub.id));

      if (subaccountId && items.length > 0 && items[0].customerName) {
        await req.db.update(orderSubaccounts)
          .set({ label: items[0].customerName })
          .where(eq(orderSubaccounts.id, subaccountId));
      }

      broadcast("qr_submission_created", { tableId: table.id, tableName: table.tableName, submissionId: sub.id, itemsCount: items.length });
      broadcast("qr_submission", { tableId: table.id, submissionId: sub.id });

      res.json({ submissionId: sub.id, orderId: order.id, message: "Pedido enviado" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/waiter/qr-submissions/:id/accept-v2", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id as string);
      const userId = req.session.userId!;

      const sub = await storage.getSubmission(subId, req.db);
      if (!sub || sub.status !== "SUBMITTED") {
        return res.status(400).json({ message: "Submission no válida o ya procesada" });
      }

      const order = await storage.getOrder(sub.orderId, req.db);
      if (!order) return res.status(400).json({ message: "Orden no encontrada" });

      const table = await storage.getTable(sub.tableId, req.db);
      if (!table) return res.status(400).json({ message: "Mesa no encontrada" });

      if (!order.responsibleWaiterId) {
        await storage.updateOrder(order.id, { responsibleWaiterId: userId }, req.db);
      }

      const payload = sub.payloadSnapshot as any;
      if (!payload || !payload.items || !Array.isArray(payload.items)) {
        return res.status(400).json({ message: "Payload inválido" });
      }

      const editedItems = req.body?.editedItems;
      const useEdited = Array.isArray(editedItems) && editedItems.length > 0;

      if (Array.isArray(editedItems) && editedItems.length === 0) {
        return res.status(400).json({ message: "No se puede aceptar un pedido sin ítems" });
      }

      const payloadItems = (useEdited ? editedItems : payload.items) as Array<{
        productId: number;
        qty: number;
        customerName?: string;
        modifiers?: Array<{ modGroupId: number; optionId: number }>;
        notes?: string;
      }>;

      let subaccount: OrderSubaccount | null = null;
      if (payload.subaccountId) {
        const [sa] = await req.db.select().from(orderSubaccounts)
          .where(eq(orderSubaccounts.id, payload.subaccountId));
        subaccount = sa || null;
      }

      const t0 = Date.now();

      const [existingItems, allCategories, allTaxCats] = await Promise.all([
        storage.getOrderItems(order.id, req.db),
        storage.getAllCategories(req.db),
        storage.getAllTaxCategories(req.db),
      ]);
      const maxRound = existingItems.reduce((max, i) => Math.max(max, i.roundNumber), 0);
      const roundNumber = maxRound + 1;

      const uniqueProductIds = Array.from(new Set(payloadItems.map(i => i.productId)));
      const allModOptionIds = Array.from(new Set(
        payloadItems.flatMap(i => (i.modifiers || []).map(m => m.optionId))
      ));

      const [productsArr, modOptionsArr, allProductTaxLinks] = await Promise.all([
        uniqueProductIds.length > 0
          ? req.db.select().from(products).where(inArray(products.id, uniqueProductIds))
          : Promise.resolve([]),
        allModOptionIds.length > 0
          ? req.db.select().from(modifierOptions).where(inArray(modifierOptions.id, allModOptionIds))
          : Promise.resolve([]),
        uniqueProductIds.length > 0
          ? storage.getProductTaxCategoriesByProductIds(uniqueProductIds, req.db)
          : Promise.resolve([]),
      ]);

      const productsMap = new Map(productsArr.map(p => [p.id, p]));
      const modOptionsMap = new Map(modOptionsArr.map(o => [o.id, o]));
      const taxLinksByProduct = new Map<number, typeof allProductTaxLinks>();
      for (const tl of allProductTaxLinks) {
        if (!taxLinksByProduct.has(tl.productId)) taxLinksByProduct.set(tl.productId, []);
        taxLinksByProduct.get(tl.productId)!.push(tl);
      }

      console.log(`[perf] accept-v2 prefetch took ${Date.now() - t0}ms`);

      const createdItems: any[] = [];
      const businessDate = await getBusinessDate();

      for (const item of payloadItems) {
        const product = productsMap.get(item.productId);
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
        }, req.db);

        await req.db.update(orderItems).set({
          subaccountId: subaccount?.id || null,
          subaccountCodeSnapshot: subaccount?.code || null,
          customerNameSnapshot: item.customerName || null,
        }).where(eq(orderItems.id, orderItem.id));

        const taxLinks = taxLinksByProduct.get(product.id) || [];
        if (taxLinks.length > 0) {
          const taxSnapshot = taxLinks.map(ptc => {
            const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
            return tc ? { taxCategoryId: tc.id, name: tc.name, rate: tc.rate, inclusive: tc.inclusive } : null;
          }).filter(Boolean);
          if (taxSnapshot.length > 0) {
            await storage.updateOrderItem(orderItem.id, { taxSnapshotJson: taxSnapshot }, req.db);
          }
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const mod of item.modifiers) {
            const option = modOptionsMap.get(mod.optionId);
            if (option) {
              await storage.createOrderItemModifier({
                orderItemId: orderItem.id,
                modifierOptionId: mod.optionId,
                nameSnapshot: option.name,
                priceDeltaSnapshot: option.priceDelta || "0",
                qty: 1,
              }, req.db);
            }
          }
        }

        let modDelta = 0;
        for (const mod of (item.modifiers || [])) {
          const option = modOptionsMap.get(mod.optionId);
          if (option) modDelta += Number(option.priceDelta || 0);
        }
        const unitWithMods = Number(product.price) + modDelta;

        await storage.createSalesLedgerItem({
          businessDate,
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
        }, req.db);

        createdItems.push({ ...orderItem, productName: product.name, categoryId: product.categoryId });
      }

      console.log(`[perf] accept-v2 items created in ${Date.now() - t0}ms`);

      await storage.updateSubmission(subId, {
        status: "ACCEPTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      }, req.db);

      const createdTicketIds: number[] = [];
      if (createdItems.length > 0) {
        const kdsTickets: Map<string, number> = new Map();

        for (const createdItem of createdItems) {
          const category = allCategories.find(c => c.id === createdItem.categoryId);
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

          await storage.updateOrderItem(createdItem.id, {
            status: "SENT",
            sentToKitchenAt: new Date(),
          }, req.db);

          if (createdItem.qty > 1) {
            const groupId = crypto.randomUUID();
            for (let seq = 1; seq <= createdItem.qty; seq++) {
              await storage.createKitchenTicketItem({
                kitchenTicketId: ticketId,
                orderItemId: createdItem.id,
                productNameSnapshot: createdItem.productNameSnapshot,
                qty: 1,
                notes: createdItem.notes,
                status: "NEW",
                kitchenItemGroupId: groupId,
                seqInGroup: seq,
              }, req.db);
            }
          } else {
            await storage.createKitchenTicketItem({
              kitchenTicketId: ticketId,
              orderItemId: createdItem.id,
              productNameSnapshot: createdItem.productNameSnapshot,
              qty: 1,
              notes: createdItem.notes,
              status: "NEW",
            }, req.db);
          }

          await storage.updateSalesLedgerItems(createdItem.id, {
            sentToKitchenAt: new Date(),
            responsibleWaiterId: userId,
          }, req.db);
        }

        console.log(`[perf] accept-v2 tickets created in ${Date.now() - t0}ms`);

        try {
          const allCreatedItemIds = createdItems.map(ci => ci.id);
          await onOrderItemsConfirmedSent(order.id, allCreatedItemIds, userId);
        } catch (deductionErr: any) {
          console.error("[inv] deduction error:", deductionErr);
        }

        console.log(`[perf] accept-v2 inventory done in ${Date.now() - t0}ms`);

        await storage.updateOrder(order.id, { status: "IN_KITCHEN" }, req.db);
      }

      await storage.recalcOrderTotal(order.id, req.db);

      storage.createAuditEvent({
        actorType: "USER",
        actorUserId: userId,
        action: "WAITER_ACCEPTED_QR_V2",
        entityType: "qr_submission",
        entityId: subId,
        tableId: sub.tableId,
        metadata: { itemCount: createdItems.length, submissionId: subId },
      }).catch(() => {});

      if (createdTicketIds.length > 0) {
        broadcast("kitchen_ticket_created", { ticketIds: createdTicketIds, tableId: sub.tableId, tableName: table.tableName });
      }
      broadcast("order_updated", { tableId: sub.tableId, orderId: order.id });
      broadcast("table_status_changed", { tableId: sub.tableId });

      const updatedOrder = await storage.getOpenOrderForTable(sub.tableId, req.db);
      const updatedItems = updatedOrder ? await storage.getOrderItems(updatedOrder.id, req.db) : [];

      console.log(`[perf] accept-v2 total ${Date.now() - t0}ms (${createdItems.length} items)`);

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

      const sub = await storage.getSubmission(subId, req.db);
      if (!sub || sub.status !== "SUBMITTED") {
        return res.status(400).json({ message: "Submission no válida o ya procesada" });
      }

      await storage.updateSubmission(subId, {
        status: "REJECTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      }, req.db);

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

  app.delete("/api/waiter/qr-submissions/:id", requireRole("WAITER", "MANAGER"), async (req, res) => {
    try {
      const subId = parseInt(req.params.id as string);
      const userId = req.session.userId!;

      const sub = await storage.getSubmission(subId, req.db);
      if (!sub || sub.status !== "SUBMITTED") {
        return res.status(400).json({ message: "Submission no válida o ya procesada" });
      }

      await storage.updateSubmission(subId, {
        status: "REJECTED",
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      }, req.db);

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

      const submissions = await req.db.select().from(qrSubmissions)
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

      const items = await storage.getOrderItems(orderId, req.db);

      const subaccountIds = Array.from(new Set(items.map(i => (i as any).subaccountId).filter(Boolean)));
      let subaccountsMap: Map<number, OrderSubaccount> = new Map();

      if (subaccountIds.length > 0) {
        const subs = await req.db.select().from(orderSubaccounts)
          .where(inArray(orderSubaccounts.id, subaccountIds));
        for (const s of subs) subaccountsMap.set(s.id, s);
      }

      const itemIds = items.map(i => i.id);
      let modsMap: Map<number, any[]> = new Map();
      if (itemIds.length > 0) {
        const allMods = await req.db.select().from(orderItemModifiers)
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

      const allItems = await storage.getOrderItems(orderId, req.db);
      const activeItems = allItems.filter((i: any) => i.status !== "VOIDED" && i.status !== "PAID");

      if (activeItems.length === 0) {
        return res.status(400).json({ message: "No hay items activos para dividir" });
      }

      const hasNames = activeItems.some((i: any) => (i as any).customerNameSnapshot);
      if (!hasNames) {
        return res.status(400).json({ message: "Los items no tienen nombres de subcuenta asignados" });
      }

      const existingSplits = await storage.getSplitAccountsForOrder(orderId, req.db);

      if (existingSplits.length > 0) {
        const existingWithItems: any[] = [];
        let existingValid = true;
        for (const s of existingSplits) {
          const sItems = await storage.getSplitItemsForSplit(s.id, req.db);
          const validItems = sItems.filter(si => activeItems.some(ai => ai.id === si.orderItemId));
          if (validItems.length === 0 && sItems.length > 0) {
            existingValid = false;
            break;
          }
          existingWithItems.push({ ...s, items: validItems });
        }
        const labelSet = new Set(existingSplits.map(s => (s.label || "").trim()));
        if (labelSet.size < existingSplits.length) {
          existingValid = false;
        }
        if (existingValid && existingWithItems.some(s => s.items.length > 0)) {
          return res.json(existingWithItems);
        }
        for (const s of existingSplits) {
          await storage.deleteSplitAccount(s.id, req.db);
        }
      }

      const nameGroups: Record<string, typeof activeItems> = {};
      for (const item of activeItems) {
        const name = ((item as any).customerNameSnapshot || "").trim();
        const key = name || "Sin subcuenta";
        if (!nameGroups[key]) nameGroups[key] = [];
        nameGroups[key].push(item);
      }

      const result: any[] = [];
      for (const name of Object.keys(nameGroups)) {
        const groupItems = nameGroups[name];
        const split = await storage.createSplitAccount({ orderId, label: name }, req.db);
        for (const item of groupItems) {
          await storage.createSplitItem({ splitId: split.id, orderItemId: item.id }, req.db);
        }
        const items = await storage.getSplitItemsForSplit(split.id, req.db);
        result.push({ ...split, items });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/review", async (req, res) => {
    try {
      const { tableCode } = req.params;
      const { orderId, rating, comment, customerName } = req.body;

      if (!orderId || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "orderId y rating (1-5) requeridos" });
      }

      if (tableCode !== "DISPATCH") {
        const [table] = await req.db
          .select({ id: tables.id })
          .from(tables)
          .where(eq(tables.tableCode, tableCode))
          .limit(1);
        if (!table) return res.status(404).json({ message: "Mesa no encontrada" });
      }

      const [order] = await req.db
        .select({ id: orders.id, orderMode: (orders as any).orderMode })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      const existing = await req.db
        .select({ id: orderReviews.id })
        .from(orderReviews)
        .where(eq(orderReviews.orderId, orderId))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ message: "Esta orden ya tiene una reseña" });
      }

      const businessDate = await getBusinessDate((req as any).tenantSchema);
      const [config] = await req.db.select().from(businessConfig).limit(1);

      const [review] = await req.db
        .insert(orderReviews)
        .values({
          orderId,
          tenantId: (req as any).tenantId || 0,
          rating,
          comment: comment || null,
          customerName: customerName || null,
          orderMode: order.orderMode || "TABLE",
          businessDate,
        })
        .returning();

      const awardedPoints = config?.reviewPoints || 0;

      if (config?.reviewEmail) {
        try {
          const { sendEmail } = await import("./services/email-service");
          const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
          const html = `
            <h2>Nueva Reseña — ${stars} (${rating}/5)</h2>
            <p><strong>Cliente:</strong> ${customerName || "Anónimo"}</p>
            <p><strong>Orden #:</strong> ${orderId}</p>
            <p><strong>Modo:</strong> ${order.orderMode || "TABLE"}</p>
            ${comment ? `<p><strong>Comentario:</strong> ${comment}</p>` : ""}
            <p><strong>Fecha:</strong> ${businessDate}</p>
          `;
          await sendEmail(config.reviewEmail, `Nueva reseña ${stars} — ${config.businessName || "RMSCore"}`, html);
        } catch {}
      }

      res.json({ success: true, reviewId: review.id, awardedPoints });
    } catch (err: any) {
      console.error("[review POST]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/qr/:tableCode/feedback", async (req, res) => {
    try {
      const { message, customerName } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ message: "El mensaje es requerido" });
      }
      const [config] = await req.db.select().from(businessConfig).limit(1);
      if (!config?.reviewEmail) {
        return res.status(200).json({ success: true, sent: false });
      }
      const { sendEmail } = await import("./services/email-service");
      const html = `
        <h2>Nuevo Mensaje de Cliente</h2>
        <p><strong>Cliente:</strong> ${customerName || "Anónimo"}</p>
        <p><strong>Mensaje:</strong></p>
        <blockquote style="padding:12px 16px;background:#f9fafb;border-left:4px solid #6366f1;margin:0;border-radius:4px;">${message.trim()}</blockquote>
        <p style="margin-top:16px;color:#6b7280;font-size:13px;">Enviado desde el flujo QR post-orden</p>
      `;
      await sendEmail(config.reviewEmail, `Mensaje de cliente — ${config.businessName || "RMSCore"}`, html);
      res.json({ success: true, sent: true });
    } catch (err: any) {
      console.error("[feedback POST]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/qr/dispatch-status/:transactionCode", async (req, res) => {
    try {
      const txCode = req.params.transactionCode;
      if (!txCode) return res.status(400).json({ message: "Código requerido" });

      // If dispatch mode is disabled, immediately cancel any pending dispatch session
      if (!await isDispatchEnabled(req.db)) {
        return res.json({ dispatchStatus: "CANCELLED", reason: "dispatch_disabled" });
      }

      const [order] = await req.db
        .select({ id: orders.id, dispatchStatus: (orders as any).dispatchStatus, status: orders.status })
        .from(orders)
        .where(eq(orders.transactionCode as any, txCode))
        .limit(1);

      if (!order) return res.status(404).json({ message: "Orden no encontrada" });

      res.json({ orderId: order.id, dispatchStatus: order.dispatchStatus || "PENDING_PAYMENT", orderStatus: order.status });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
