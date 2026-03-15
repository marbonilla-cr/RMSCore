import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function check() {
  const client = await pool.connect();
  try {
    const { rows: tenants } = await client.query(
      "SELECT id, slug, schema_name, is_active, plan, created_at FROM public.tenants ORDER BY id"
    );
    console.log("=== TENANTS ===");
    console.log(JSON.stringify(tenants, null, 2));

    const { rows: modules } = await client.query(
      "SELECT id, tenant_id, module_key, is_active FROM public.tenant_modules ORDER BY tenant_id, id"
    );
    console.log("\n=== TENANT MODULES ===");
    console.log(JSON.stringify(modules, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

check().catch(console.error);
