import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Prevent pg-pool idle client errors from crashing the process.
// These can happen transiently (network hiccups, Railway proxy resets, etc).
pool.on("error", (err) => {
  console.error("[db] Pool error (non-fatal):", err?.message ?? err);
});

export const db = drizzle(pool, { schema });

export async function ensurePerfIndexes(schemaName: string) {
  const safeSchema = schemaName.replaceAll('"', '""');
  const s = `"${safeSchema}"`;

  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_order_per_table
  ON ${s}.orders (table_id)
  WHERE parent_order_id IS NULL AND status IN ('OPEN', 'IN_KITCHEN', 'READY', 'PREPARING')`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item_id ON ${s}.order_item_modifiers (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_taxes_item_id ON ${s}.order_item_taxes (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_discounts_item_id ON ${s}.order_item_discounts (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_discounts_order_id ON ${s}.order_item_discounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_accounts_order_id ON ${s}.split_accounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_items_split_id ON ${s}.split_items (split_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_items_order_item_id ON ${s}.split_items (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_subaccounts_order_id ON ${s}.order_subaccounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_ledger_items_order_item_id ON ${s}.sales_ledger_items (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_ledger_items_order_id ON ${s}.sales_ledger_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voided_items_order_id ON ${s}.voided_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_tax_categories_product_id ON ${s}.product_tax_categories (product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qr_submissions_order_id ON ${s}.qr_submissions (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_order_id ON ${s}.payments (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_status ON ${s}.order_items (order_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_table_status ON ${s}.orders (table_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_kti_order_item_id ON ${s}.kitchen_ticket_items (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON ${s}.orders (status) WHERE status IN ('OPEN', 'IN_KITCHEN', 'PREPARING', 'READY')`,
    `CREATE INDEX IF NOT EXISTS idx_payments_business_date ON ${s}.payments (business_date, status)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_ledger_business_date ON ${s}.sales_ledger_items (business_date)`,
  ];
  for (const ddl of indexes) {
    try { await pool.query(ddl); } catch (err: any) {
      console.error(`[db] Index creation failed: ${err.message}`);
    }
  }
  console.log(`[db] ${indexes.length} performance indexes ensured for schema: ${schemaName}`);

  try {
    const { rowCount } = await pool.query(`
      UPDATE ${s}.inv_items 
      SET avg_cost_per_base_uom = last_cost_per_base_uom, updated_at = now()
      WHERE avg_cost_per_base_uom = 0 
        AND last_cost_per_base_uom > 0
    `);
    if (rowCount && rowCount > 0) {
      console.log(`[db] Migrated avg_cost for ${rowCount} inv_items`);
    }
  } catch (err: any) {
    console.error(`[db] avg_cost migration failed: ${err.message}`);
  }
}
