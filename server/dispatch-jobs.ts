import { Pool } from "pg";
import { getTenantDb } from "./db-tenant";
import * as storage from "./storage";
import { orders, orderItems } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

const publicPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

let broadcastFn: ((type: string, payload: any) => void) | null = null;

export function initDispatchJobs(broadcast: (type: string, payload: any) => void) {
  broadcastFn = broadcast;
}

export function startDispatchBackgroundJobs() {
  setInterval(async () => {
    try {
      const { rows: tenants } = await publicPool.query(
        `SELECT schema_name FROM public.tenants WHERE is_active = true`
      );
      const schemas = tenants.map((t: any) => t.schema_name);
      if (schemas.length === 0) schemas.push(process.env.TENANT_SCHEMA || "public");

      for (const schema of schemas) {
        try {
          await autoExpireDispatchOrders(schema);
        } catch (err: any) {
          console.error(`[Dispatch-Jobs] AutoExpire error for schema ${schema}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[Dispatch-Jobs] AutoExpire error:", err);
    }
  }, 2 * 60 * 1000);

  console.log("[Dispatch-Jobs] Auto-expire job started (every 2 min)");
}

async function autoExpireDispatchOrders(schema: string) {
  const tenantDb = getTenantDb(schema);

  const bizConfig = await storage.getBusinessConfig(schema);
  const timeoutMinutes = (bizConfig as any)?.dispatchOrderTimeoutMinutes ?? 15;
  if (!timeoutMinutes || timeoutMinutes <= 0) return;

  const expiredOrders = await tenantDb.select().from(orders)
    .where(and(
      sql`${orders.status} = 'OPEN'`,
      sql`${(orders as any).orderMode} = 'DISPATCH'`,
      sql`${(orders as any).dispatchStatus} = 'PENDING_PAYMENT'`,
      sql`${orders.openedAt} < NOW() - INTERVAL '${sql.raw(String(timeoutMinutes))} minutes'`
    ));

  for (const order of expiredOrders) {
    try {
      const allItems = await storage.getOrderItems(order.id, tenantDb);
      const pendingItems = allItems.filter(i => i.status === "PENDING");
      for (const item of pendingItems) {
        await storage.updateOrderItem(item.id, { status: "VOIDED" }, tenantDb);
      }
      await tenantDb.update(orders)
        .set({ dispatchStatus: "CANCELLED", status: "CANCELLED" } as any)
        .where(eq(orders.id, order.id));
      await storage.recalcOrderTotal(order.id, tenantDb);

      console.log(`[Dispatch-Jobs] Auto-expired dispatch order #${order.id} (schema=${schema}, timeout=${timeoutMinutes}min)`);

      if (broadcastFn) {
        broadcastFn("dispatch_order_cancelled", { orderId: order.id, transactionCode: (order as any).transactionCode, reason: "timeout" });
        broadcastFn("table_status_changed", { tableId: order.tableId });
      }
    } catch (err: any) {
      console.error(`[Dispatch-Jobs] Error expiring order #${order.id}:`, err.message);
    }
  }
}
