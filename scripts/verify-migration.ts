import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function verify() {
  const client = await pool.connect();
  try {
    const { rows: tenants } = await client.query(
      "SELECT id, slug, schema_name FROM public.tenants"
    );
    console.log("Tenants:", JSON.stringify(tenants, null, 2));

    const tables = ["orders", "order_items", "payments", "sales_ledger_items", "hr_time_punches", "users"];
    console.log("\nConteos en tenant_la_antigua:");
    for (const t of tables) {
      const { rows: [cnt] } = await client.query(
        `SELECT COUNT(*) as count FROM tenant_la_antigua.${t}`
      );
      console.log(`  ${t}: ${cnt.count}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(console.error);
