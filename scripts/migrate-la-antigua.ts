import { Pool, PoolClient } from "pg";

const DB_URL = process.env.DATABASE_URL!;
const TENANT_SLUG = "rms";
const NEW_SCHEMA = "tenant_la_antigua";
const SOURCE_SCHEMA = "public";

const GLOBAL_TABLES = new Set([
  "tenants",
  "tenant_modules",
  "superadmin_users",
  "provision_log",
  "billing_events",
  "schema_migrations",
]);

const GLOBAL_SEQUENCE_PREFIXES = [
  "tenants_",
  "tenant_modules_",
  "superadmin_",
  "provision_",
  "billing_",
  "schema_migrations_",
];

const pool = new Pool({ connectionString: DB_URL, max: 1 });

interface TenantRow {
  id: number;
  slug: string;
  schema_name: string;
  plan: string;
  is_active: boolean;
}

interface TableRow {
  tablename: string;
}

interface SequenceRow {
  sequence_name: string;
}

interface CountRow {
  count: string;
}

interface SeqValRow {
  last_value: string;
}

interface ColumnDefaultRow {
  table_name: string;
  column_name: string;
  column_default: string;
}

async function getTenantTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<TableRow>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = $1
    AND tablename NOT IN (${[...GLOBAL_TABLES].map((_, i) => `$${i + 2}`).join(", ")})
    ORDER BY tablename
  `, [SOURCE_SCHEMA, ...GLOBAL_TABLES]);
  return rows.map(r => r.tablename);
}

async function getTenantSequences(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<SequenceRow>(`
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema = $1
  `, [SOURCE_SCHEMA]);

  return rows
    .map(r => r.sequence_name)
    .filter(name => !GLOBAL_SEQUENCE_PREFIXES.some(prefix => name.startsWith(prefix)));
}

async function getRowCount(client: PoolClient, schema: string, table: string): Promise<number> {
  const { rows } = await client.query<CountRow>(
    `SELECT COUNT(*) as count FROM "${schema}"."${table}"`
  );
  return Number(rows[0].count);
}

async function createTenantSequence(
  client: PoolClient,
  seqName: string,
  sourceValue: number
): Promise<void> {
  await client.query(`CREATE SEQUENCE IF NOT EXISTS "${NEW_SCHEMA}"."${seqName}"`);
  await client.query(
    `SELECT setval('"${NEW_SCHEMA}"."${seqName}"', $1, true)`,
    [sourceValue]
  );
}

async function rewriteColumnDefaults(client: PoolClient, tables: string[]): Promise<number> {
  const { rows: cols } = await client.query<ColumnDefaultRow>(`
    SELECT table_name, column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = $1
    AND column_default LIKE 'nextval(%'
  `, [NEW_SCHEMA]);

  let rewritten = 0;
  for (const col of cols) {
    const match = col.column_default.match(/nextval\('([^']+)'::regclass\)/);
    if (!match) continue;

    const rawSeqRef = match[1];
    const seqName = rawSeqRef.includes(".") ? rawSeqRef.split(".").pop()! : rawSeqRef;
    const qualifiedSeq = `${NEW_SCHEMA}.${seqName}`;
    const newDefault = `nextval('${qualifiedSeq}'::regclass)`;

    if (col.column_default !== newDefault) {
      await client.query(
        `ALTER TABLE "${NEW_SCHEMA}"."${col.table_name}"
         ALTER COLUMN "${col.column_name}"
         SET DEFAULT nextval('"${NEW_SCHEMA}"."${seqName}"'::regclass)`
      );
      rewritten++;
    }
  }
  return rewritten;
}

async function verifyIsolation(client: PoolClient): Promise<void> {
  const { rows: seqs } = await client.query<CountRow>(
    `SELECT COUNT(*) as count FROM information_schema.sequences WHERE sequence_schema = $1`,
    [NEW_SCHEMA]
  );
  const seqCount = Number(seqs[0].count);

  const { rows: stale } = await client.query<CountRow>(`
    SELECT COUNT(*) as count FROM information_schema.columns
    WHERE table_schema = $1
    AND column_default LIKE 'nextval(%'
    AND column_default NOT LIKE $2
  `, [NEW_SCHEMA, `%${NEW_SCHEMA}%`]);
  const staleCount = Number(stale[0].count);

  const { rows: migs } = await client.query<CountRow>(
    `SELECT COUNT(*) as count FROM public.schema_migrations WHERE schema_name = $1`,
    [NEW_SCHEMA]
  );
  const migCount = Number(migs[0].count);

  console.log(`  Secuencias en ${NEW_SCHEMA}: ${seqCount}`);
  console.log(`  Defaults apuntando a public: ${staleCount}`);
  console.log(`  Migraciones registradas: ${migCount}`);

  if (staleCount > 0) {
    console.warn(`  ⚠ ${staleCount} columna(s) aún apuntan a secuencias de public`);
  }
  if (seqCount === 0) {
    console.warn(`  ⚠ No hay secuencias en ${NEW_SCHEMA} — aislamiento incompleto`);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    console.log("=== MIGRACIÓN LA ANTIGUA ===");
    console.log("Tenant slug:", TENANT_SLUG);
    console.log("Source schema:", SOURCE_SCHEMA);
    console.log("Target schema:", NEW_SCHEMA);

    console.log("\n[PASO 1] Verificando tenant...");
    const { rows: tenants } = await client.query<TenantRow>(
      `SELECT id, slug, schema_name, plan, is_active FROM public.tenants WHERE slug = $1`,
      [TENANT_SLUG]
    );

    if (tenants.length === 0) {
      throw new Error(`Tenant con slug '${TENANT_SLUG}' no encontrado. Abortando.`);
    }
    const tenant = tenants[0];

    if (tenant.schema_name === NEW_SCHEMA) {
      console.log("Tenant ya apunta a", NEW_SCHEMA, "— verificando estado...");
      await verifyIsolation(client);
      console.log("Migración ya completada y verificada.");
      return;
    }
    if (tenant.schema_name !== SOURCE_SCHEMA) {
      throw new Error(
        `Tenant '${TENANT_SLUG}' tiene schema_name='${tenant.schema_name}', esperado '${SOURCE_SCHEMA}'. Abortando.`
      );
    }
    console.log(`✓ Tenant encontrado: id=${tenant.id}, slug=${tenant.slug}, schema=${tenant.schema_name}`);

    console.log("\n[PASO 2] Creando schema", NEW_SCHEMA, "...");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${NEW_SCHEMA}"`);
    console.log("✓ Schema creado");

    console.log("\n[PASO 3] Obteniendo tablas tenant...");
    const tables = await getTenantTables(client);
    console.log(`✓ ${tables.length} tablas: ${tables.join(", ")}`);

    console.log("\n[PASO 4] Copiando tablas...");
    const failedTables: string[] = [];
    for (const tablename of tables) {
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS "${NEW_SCHEMA}"."${tablename}"
           (LIKE "${SOURCE_SCHEMA}"."${tablename}" INCLUDING ALL)`
        );
        const result = await client.query(
          `INSERT INTO "${NEW_SCHEMA}"."${tablename}"
           SELECT * FROM "${SOURCE_SCHEMA}"."${tablename}"
           ON CONFLICT DO NOTHING`
        );
        console.log(`  ✓ ${tablename}: ${result.rowCount} filas`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${tablename}: ${msg}`);
        failedTables.push(tablename);
      }
    }
    if (failedTables.length > 0) {
      throw new Error(`${failedTables.length} tabla(s) fallaron al copiar: ${failedTables.join(", ")}. Abortando.`);
    }

    console.log("\n[PASO 5] Creando secuencias aisladas en", NEW_SCHEMA, "...");
    const sequences = await getTenantSequences(client);
    let seqCreated = 0;
    let seqFailed = 0;
    for (const seqName of sequences) {
      try {
        const { rows } = await client.query<SeqValRow>(
          `SELECT last_value FROM "${SOURCE_SCHEMA}"."${seqName}"`
        );
        const sourceValue = Number(rows[0].last_value);
        await createTenantSequence(client, seqName, sourceValue);
        console.log(`  ✓ ${seqName}: ${sourceValue}`);
        seqCreated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${seqName}: ${msg}`);
        seqFailed++;
      }
    }
    if (seqFailed > 0) {
      throw new Error(`${seqFailed} secuencia(s) fallaron. Abortando para evitar IDs compartidos.`);
    }
    console.log(`✓ ${seqCreated} secuencias creadas`);

    console.log("\n[PASO 5b] Reescribiendo defaults a secuencias del tenant...");
    const rewritten = await rewriteColumnDefaults(client, tables);
    console.log(`✓ ${rewritten} columna(s) reescrita(s)`);

    console.log("\n[PASO 6] Verificando integridad (source vs destination)...");
    let allOk = true;
    for (const tablename of tables) {
      const srcCount = await getRowCount(client, SOURCE_SCHEMA, tablename);
      const dstCount = await getRowCount(client, NEW_SCHEMA, tablename);
      const ok = dstCount >= srcCount;
      if (!ok || srcCount > 0) {
        console.log(`  ${ok ? "✓" : "✗"} ${tablename}: src=${srcCount} dst=${dstCount}`);
      }
      if (!ok) allOk = false;
    }
    if (!allOk) {
      throw new Error("Verificación de integridad FALLÓ. No se actualiza el tenant.");
    }
    console.log("✓ Todas las tablas verificadas");

    console.log("\n[PASO 7] Cutover atómico...");
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE public.tenants SET schema_name = $1 WHERE id = $2 AND slug = $3`,
        [NEW_SCHEMA, tenant.id, TENANT_SLUG]
      );

      const migrationFiles = await getMigrationFiles(client);
      for (const filename of migrationFiles) {
        await client.query(
          `INSERT INTO public.schema_migrations (schema_name, filename)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [NEW_SCHEMA, filename]
        );
      }

      await client.query("COMMIT");
      console.log(`✓ Tenant actualizado: schema_name = ${NEW_SCHEMA}`);
      console.log(`✓ ${migrationFiles.length} migraciones marcadas como aplicadas`);
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cutover falló, ROLLBACK aplicado: ${msg}`);
    }

    console.log("\n[PASO 8] Verificación final...");
    const { rows: [updated] } = await client.query<TenantRow>(
      `SELECT id, slug, schema_name, plan, is_active FROM public.tenants WHERE id = $1`,
      [tenant.id]
    );
    console.log(`✓ Tenant: id=${updated.id} slug=${updated.slug} schema=${updated.schema_name} plan=${updated.plan}`);

    const { rows: migChecks } = await client.query<CountRow>(
      `SELECT COUNT(*) as count FROM public.schema_migrations WHERE schema_name = $1`,
      [NEW_SCHEMA]
    );
    console.log(`✓ Migraciones registradas: ${migChecks[0].count}`);

    console.log("\n=== MIGRACIÓN COMPLETADA ✓ ===");
    console.log("El schema 'public' aún tiene los datos originales.");
    console.log("No limpiar public hasta verificar que el sistema funciona correctamente.");
    console.log("Rollback: UPDATE public.tenants SET schema_name = 'public' WHERE slug = 'rms';");

  } catch (err: unknown) {
    console.error("\n=== ERROR EN MIGRACIÓN ===");
    console.error(err instanceof Error ? err.message : String(err));
    console.error("Verificar estado del tenant antes de reintentar.");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function getMigrationFiles(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ filename: string }>(
    `SELECT DISTINCT filename FROM public.schema_migrations WHERE schema_name = 'public' ORDER BY filename`
  );
  return rows.map(r => r.filename);
}

run();
