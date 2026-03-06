import { Pool } from "pg";
import fs from "fs";
import path from "path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

function getMigrationFiles(): string[] {
  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
}

async function getAppliedMigrations(schemaName: string): Promise<Set<string>> {
  try {
    const { rows } = await pool.query(
      `SELECT filename FROM public.schema_migrations WHERE schema_name = $1`,
      [schemaName]
    );
    return new Set(rows.map((r: any) => r.filename));
  } catch {
    return new Set();
  }
}

async function applyMigration(
  schemaName: string,
  filename: string,
  sql: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    await client.query(sql);
    await client.query(
      `INSERT INTO public.schema_migrations (schema_name, filename)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [schemaName, filename]
    );
    await client.query("COMMIT");
    console.log(`[migrate] ✓ ${schemaName} ← ${filename}`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    throw new Error(`[migrate] Error en ${schemaName}/${filename}: ${err.message}`);
  } finally {
    client.release();
  }
}

export async function propagateMigrations(targetSchema?: string): Promise<void> {
  const files = getMigrationFiles();
  if (files.length === 0) {
    console.log("[migrate] Sin archivos de migración — nada que hacer");
    return;
  }

  let schemas: string[];
  if (targetSchema) {
    schemas = [targetSchema];
  } else {
    const { rows } = await pool.query(
      `SELECT schema_name FROM public.tenants
       WHERE is_active = true AND status = 'ACTIVE'`
    );
    schemas = rows.map((r: any) => r.schema_name);
  }

  if (schemas.length === 0) {
    console.log("[migrate] Sin tenants activos — nada que propagar");
    return;
  }

  console.log(`[migrate] ${files.length} archivo(s) → ${schemas.length} schema(s)`);

  for (const schemaName of schemas) {
    const applied = await getAppliedMigrations(schemaName);
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log(`[migrate] ${schemaName}: al día ✓`);
      continue;
    }

    console.log(`[migrate] ${schemaName}: ${pending.length} pendiente(s)`);

    for (const filename of pending) {
      const filePath = path.join(process.cwd(), "migrations", filename);
      const sql = fs.readFileSync(filePath, "utf-8");
      await applyMigration(schemaName, filename, sql);
    }
  }

  console.log("[migrate] Propagación completada ✓");
}

export async function getMigrationStatus(): Promise<{
  totalFiles: number;
  tenants: {
    tenantId: number;
    slug: string;
    schemaName: string;
    plan: string;
    appliedCount: number;
    pendingCount: number;
    lastAppliedAt: string | null;
    isUpToDate: boolean;
  }[];
}> {
  const files = getMigrationFiles();
  const totalFiles = files.length;

  const { rows: tenants } = await pool.query(
    `SELECT id, slug, schema_name, plan, status FROM public.tenants
     ORDER BY created_at`
  );

  const result = await Promise.all(
    tenants.map(async (t: any) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count, MAX(applied_at) as last_applied
         FROM public.schema_migrations WHERE schema_name = $1`,
        [t.schema_name]
      );
      const appliedCount = parseInt(rows[0].count);
      const pendingCount = totalFiles - appliedCount;
      return {
        tenantId: t.id,
        slug: t.slug,
        schemaName: t.schema_name,
        plan: t.plan,
        status: t.status,
        appliedCount,
        pendingCount,
        lastAppliedAt: rows[0].last_applied,
        isUpToDate: pendingCount === 0,
      };
    })
  );

  return { totalFiles, tenants: result };
}
