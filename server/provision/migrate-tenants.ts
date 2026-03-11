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
    if (schemaName === 'public') {
      await client.query(`SET LOCAL search_path TO "public"`);
    } else {
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);
    }
    const statements = sql
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      try {
        await client.query(statements[i]);
      } catch (err: any) {
        throw new Error(
          `Statement ${i + 1}/${statements.length} failed: ` +
          `${statements[i].substring(0, 200)} — ${err.message}`
        );
      }
    }
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
  files: string[];
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

  return { totalFiles, files, tenants: result };
}

export async function markMigrationsAsApplied(
  schemaName: string,
  filenames: string[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const filename of filenames) {
      await client.query(
        `INSERT INTO public.schema_migrations (schema_name, filename)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [schemaName, filename]
      );
    }
    await client.query("COMMIT");
    console.log(`[migrate] Marcadas ${filenames.length} migración(es) como aplicadas para ${schemaName}`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    throw new Error(`[migrate] Error marcando migraciones para ${schemaName}: ${err.message}`);
  } finally {
    client.release();
  }
}

async function verifyMigrations(schemaName: string): Promise<void> {
  const files = getMigrationFiles();
  const applied = await getAppliedMigrations(schemaName);
  let warnings = 0;

  for (const filename of files) {
    if (!applied.has(filename)) {
      console.warn(`[migrate-verify] ⚠ ${schemaName}: ${filename} NO está registrada — debería haberse aplicado`);
      warnings++;
    }
  }

  if (warnings > 0) {
    console.warn(`[migrate-verify] ⚠ ${schemaName}: ${warnings} migración(es) sin registrar`);
  } else {
    console.log(`[migrate-verify] ✓ ${schemaName}: verificación completa`);
  }
}

export async function syncAllTenantsAtStartup(): Promise<void> {
  try {
    console.log('[migrate] Starting startup sync...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id          SERIAL PRIMARY KEY,
        schema_name TEXT NOT NULL,
        filename    TEXT NOT NULL,
        applied_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (schema_name, filename)
      )
    `);

    await propagateMigrations('public');
    await verifyMigrations('public');

    const { rows } = await pool.query(
      `SELECT id, slug, schema_name FROM public.tenants
       WHERE is_active = true AND schema_name != 'public'
       ORDER BY created_at`
    );

    for (const tenant of rows) {
      try {
        await propagateMigrations(tenant.schema_name);
        await verifyMigrations(tenant.schema_name);
      } catch (err: any) {
        console.error(
          `[migrate] ERROR syncing tenant ${tenant.slug}: `,
          err.message
        );
      }
    }

    console.log('[migrate] Startup sync complete ✓');
  } catch (err: any) {
    console.error('[migrate] Startup sync failed:', err.message);
  }
}
