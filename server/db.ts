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

export const db = drizzle(pool, { schema });

pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_order_per_table 
  ON orders (table_id) 
  WHERE parent_order_id IS NULL AND status IN ('OPEN', 'IN_KITCHEN', 'READY', 'PREPARING');
`).catch((err) => {
  console.error("[db] Failed to create unique open order index:", err.message);
});

async function ensurePerfIndexes() {
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item_id ON order_item_modifiers (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_taxes_item_id ON order_item_taxes (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_discounts_item_id ON order_item_discounts (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_discounts_order_id ON order_item_discounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_accounts_order_id ON split_accounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_items_split_id ON split_items (split_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_items_order_item_id ON split_items (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_subaccounts_order_id ON order_subaccounts (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_ledger_items_order_item_id ON sales_ledger_items (order_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_ledger_items_order_id ON sales_ledger_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voided_items_order_id ON voided_items (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_tax_categories_product_id ON product_tax_categories (product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qr_submissions_order_id ON qr_submissions (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_status ON order_items (order_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders (table_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_kti_order_item_id ON kitchen_ticket_items (order_item_id)`,
  ];
  for (const ddl of indexes) {
    try { await pool.query(ddl); } catch (err: any) {
      console.error(`[db] Index creation failed: ${err.message}`);
    }
  }
  console.log(`[db] ${indexes.length} performance indexes ensured`);
}
ensurePerfIndexes();
