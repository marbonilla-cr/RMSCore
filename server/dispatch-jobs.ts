import { Pool } from "pg";
import { getTenantDb } from "./db-tenant";
import * as storage from "./storage";
import { orders, orderItems } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

const publicPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

let broadcastFn: ((tenantId: number, event: string, data: any) => void) | null = null;

export function initDispatchJobs(broadcast: (tenantId: number, event: string, data: any) => void) {
  broadcastFn = broadcast;
}

export function startDispatchBackgroundJobs() {
  setInterval(async () => {
    try {
      const { rows: tenants } = await publicPool.query(
        `SELECT id, schema_name FROM public.tenants WHERE is_active = true`
      );
      const tenantRows = tenants.map((t: any) => ({ id: Number(t.id), schema_name: t.schema_name }));

      if (tenantRows.length === 0) {
        const schemaName = process.env.TENANT_SCHEMA || "public";
        const { rows: fallbackRows } = await publicPool.query(
          `SELECT id FROM public.tenants WHERE schema_name = $1 LIMIT 1`,
          [schemaName]
        );
        const tenantId = fallbackRows.length ? Number(fallbackRows[0].id) : 0;
        tenantRows.push({ id: tenantId, schema_name: schemaName });
      }

      for (const tenant of tenantRows) {
        try {
          await autoExpireDispatchOrders(tenant.schema_name, tenant.id);
        } catch (err: any) {
          console.error(`[Dispatch-Jobs] AutoExpire error for schema ${tenant.schema_name}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[Dispatch-Jobs] AutoExpire error:", err);
    }
  }, 2 * 60 * 1000);

  console.log("[Dispatch-Jobs] Auto-expire job started (every 2 min)");
}

async function autoExpireDispatchOrders(schema: string, tenantId: number) {
  const tenantDb = getTenantDb(schema);

  const bizConfig = await storage.getBusinessConfig(schema);
  const timeoutMinutes = (bizConfig as any)?.dispatchOrderTimeoutMinutes ?? 15;
  if (!timeoutMinutes || timeoutMinutes <= 0) return;

  const expiredOrders = await tenantDb.select().from(orders)
    .where(and(
      sql`${(orders as any).orderMode} = 'DISPATCH'`,
      sql`${(orders as any).dispatchStatus} = 'PENDING_PAYMENT'`,
      sql`${orders.openedAt} < NOW() - INTERVAL '${sql.raw(String(timeoutMinutes))} minutes'`
    ));

  for (const order of expiredOrders) {
    try {
      const allItems = await storage.getOrderItems(order.id, tenantDb);
      // Cancelar de forma robusta: cualquier ítem no-voided / no-paid debe quedar VOIDED.
      const itemsToVoid = allItems.filter(i => i.status !== "VOIDED" && i.status !== "PAID");
      for (const item of itemsToVoid) {
        await storage.updateOrderItem(item.id, { status: "VOIDED" }, tenantDb);
      }
      await tenantDb.update(orders)
        .set({ dispatchStatus: "CANCELLED", status: "CANCELLED" } as any)
        .where(eq(orders.id, order.id));
      await storage.recalcOrderTotal(order.id, tenantDb);

      console.log(`[Dispatch-Jobs] Auto-expired dispatch order #${order.id} (schema=${schema}, timeout=${timeoutMinutes}min)`);

      if (broadcastFn) {
        broadcastFn(tenantId, "dispatch_order_cancelled", { orderId: order.id, transactionCode: (order as any).transactionCode, reason: "timeout" });
        broadcastFn(tenantId, "table_status_changed", { tableId: order.tableId });
      }
    } catch (err: any) {
      console.error(`[Dispatch-Jobs] Error expiring order #${order.id}:`, err.message);
    }
  }
}
