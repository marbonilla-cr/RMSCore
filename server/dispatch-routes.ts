/**
 * server/dispatch-routes.ts
 *
 * Modelo 3: Despacho (Food Court / QR Directo)
 * El cliente ordena desde QR → va directo a cocina → notificación cuando está lista.
 * QR de despacho: /qr/MESA-01?mode=dispatch
 */

import type { Express, Request, Response } from "express";
import { WebSocket } from "ws";
import { eq, and, inArray } from "drizzle-orm";
import { db as globalDb } from "./db";
import * as schema from "@shared/schema";

const dispatchSessions = new Map<number, WebSocket>();

export function registerDispatchSession(orderId: number, ws: WebSocket) {
  dispatchSessions.set(orderId, ws);
  ws.on("close", () => dispatchSessions.delete(orderId));
  console.log(`[dispatch] Sesión registrada para orden ${orderId}`);
}

export function notifyDispatchReady(orderId: number, payload: {
  orderId: number; customerName: string; tableCode: string;
  items: { name: string; qty: number }[]; readyAt: string;
}) {
  const ws = dispatchSessions.get(orderId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "dispatch_ready", payload }));
    dispatchSessions.delete(orderId);
    console.log(`[dispatch] ✓ Notificación enviada: orden ${orderId}`);
    return true;
  }
  return false;
}

export function registerDispatchRoutes(app: Express, broadcast: Function) {

  app.post("/api/dispatch/:tableCode/submit", async (req: Request, res: Response) => {
    try {
      const tableCode = req.params.tableCode as string;
      const { items, customerName } = req.body;
      const db = (req as any).db || globalDb;

      if (!items?.length) return res.status(400).json({ message: "Items requeridos" });
      if (!customerName?.trim()) return res.status(400).json({ message: "Nombre requerido" });

      const [table] = await db.select().from(schema.tables).where(eq(schema.tables.tableCode, tableCode));
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const openOrders = await db.select().from(schema.orders).where(
        and(eq(schema.orders.tableId, table.id), inArray(schema.orders.status, ["OPEN","IN_KITCHEN","READY","PREPARING"]))
      );

      let order = openOrders[0];
      if (!order) {
        const { getTenantTimezone, getBusinessDateInTZ } = await import("./utils/timezone");
        const tz = await getTenantTimezone(req.tenantSchema || process.env.TENANT_SCHEMA || "public");
        const businessDate = getBusinessDateInTZ(tz);
        [order] = await db.insert(schema.orders).values({ tableId: table.id, status: "OPEN", businessDate, responsibleWaiterId: null }).returning();
      }

      const existingItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const roundNumber = existingItems.reduce((max: number, i: any) => Math.max(max, i.roundNumber || 0), 0) + 1;

      const insertedItems = [];
      for (const item of items) {
        const [orderItem] = await db.insert(schema.orderItems).values({
          orderId: order.id, productId: item.productId,
          productNameSnapshot: item.productName || item.name,
          productPriceSnapshot: String(item.unitPrice || item.price || "0"),
          qty: item.qty || 1, status: "NEW", roundNumber,
          customerNameSnapshot: customerName.trim(), notes: item.notes || null,
        }).returning();
        insertedItems.push(orderItem);
      }

      await db.update(schema.orders).set({ status: "IN_KITCHEN" }).where(eq(schema.orders.id, order.id));

      const [ticket] = await db.insert(schema.kitchenTickets).values({
        orderId: order.id, tableNameSnapshot: table.tableName, status: "PENDING", destination: "cocina",
      }).returning();

      for (const orderItem of insertedItems) {
        await db.insert(schema.kitchenTicketItems).values({
          ticketId: ticket.id, orderItemId: orderItem.id,
          productNameSnapshot: orderItem.productNameSnapshot, qty: orderItem.qty,
          status: "NEW", notes: orderItem.notes, customerNameSnapshot: orderItem.customerNameSnapshot,
        });
      }

      broadcast("kitchen_ticket_created", { ticketId: ticket.id, orderId: order.id, tableNameSnapshot: table.tableName, destination: "cocina" });
      broadcast("order_updated", { orderId: order.id, status: "IN_KITCHEN" });
      broadcast("qr_submission_created", { tableId: table.id, tableCode, customerName: customerName.trim(), orderId: order.id, mode: "DISPATCH" });

      res.json({ ok: true, orderId: order.id, tableCode, customerName: customerName.trim(), message: "Orden enviada a cocina. Mantén esta pantalla abierta." });

    } catch (err: any) {
      console.error("[dispatch] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch/order/:orderId/status", async (req: Request, res: Response) => {
    try {
      const orderId = parseInt(req.params.orderId as string);
      const db = (req as any).db || globalDb;
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      res.json({ orderId, status: order.status, isReady: order.status === "READY", hasActiveSession: dispatchSessions.has(orderId) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  console.log("[dispatch] Rutas de despacho registradas");
}
