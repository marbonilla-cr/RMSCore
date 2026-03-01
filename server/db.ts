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
