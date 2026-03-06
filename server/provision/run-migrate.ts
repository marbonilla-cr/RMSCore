import { Pool } from "pg";
import fs from "fs";
import path from "path";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id          SERIAL PRIMARY KEY,
      schema_name TEXT NOT NULL,
      filename    TEXT NOT NULL,
      applied_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (schema_name, filename)
    )
  `);

  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) {
    console.log("No existe carpeta migrations/ — nada que aplicar");
    process.exit(0);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  const { rows } = await pool.query(
    `SELECT filename FROM public.schema_migrations WHERE schema_name = 'public'`
  );
  const applied = new Set(rows.map((r: any) => r.filename));
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log("public: ya al día ✓");
    await pool.end();
    return;
  }

  console.log(`public: ${pending.length} migración(es) pendiente(s)`);

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(dir, filename), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO public`);
      await client.query(sql);
      await client.query(
        `INSERT INTO public.schema_migrations (schema_name, filename)
         VALUES ('public', $1) ON CONFLICT DO NOTHING`,
        [filename]
      );
      await client.query("COMMIT");
      console.log(`✓ ${filename}`);
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error(`✗ ${filename}: ${err.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log("Migraciones aplicadas en public ✓");
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
