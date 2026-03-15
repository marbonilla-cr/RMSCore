import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function cleanup() {
  const client = await pool.connect();
  try {
    const { rows: before } = await client.query(
      "SELECT id, slug, schema_name FROM public.tenants ORDER BY id"
    );
    console.log("Antes:", JSON.stringify(before, null, 2));

    await client.query(
      "DELETE FROM public.tenant_modules WHERE tenant_id = 9"
    );
    console.log("✓ Módulos del tenant fantasma eliminados");

    await client.query(
      "DELETE FROM public.tenants WHERE id = 9 AND slug = 'rest-la-antigua' AND schema_name = 'public'"
    );
    console.log("✓ Tenant fantasma eliminado");

    const { rows: after } = await client.query(
      "SELECT id, slug, schema_name FROM public.tenants ORDER BY id"
    );
    console.log("Después:", JSON.stringify(after, null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch(console.error);
