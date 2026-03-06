# RMSCore — Sistema Multi-Tenant: Migraciones + Sequences + Re-provisionamiento + Dashboard de Versiones

## DESCRIPCIÓN GENERAL

Este prompt implementa de forma unificada y ordenada todo el sistema de
provisioning robusto para multi-tenant. Cubre:

1. Sistema de migraciones versionadas con propagador automático
2. Configuración de sequences de numeración por tenant
3. Re-provisionamiento de tenants fallidos
4. Dashboard de versiones de schema en el superadmin

**REGLA DE ORO POST-IMPLEMENTACIÓN:**
Nunca más usar `npm run db:push`.
El flujo nuevo es: editar schema.ts → `npm run db:generate` → `npm run db:migrate`

---

## PARTE 1 — SISTEMA DE MIGRACIONES VERSIONADAS

### P1-T001 — Crear tabla de control global

Ejecutar este SQL en la base de datos (en la terminal de Replit,
usando `psql $DATABASE_URL` o desde el panel de DB):

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id          SERIAL PRIMARY KEY,
  schema_name TEXT NOT NULL,
  filename    TEXT NOT NULL,
  applied_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (schema_name, filename)
);
```

Esta tabla vive en `public` (global) y registra qué archivo de
migración fue aplicado en qué schema de tenant y cuándo.

### P1-T002 — Generar archivo baseline

En la terminal de Replit:

```bash
npx drizzle-kit generate --name=baseline
```

Verificar que se creó:
```bash
ls -la migrations/
```

Debe aparecer un archivo `.sql` con prefijo `0000_`. Anotar el
nombre exacto del archivo — se usa en el siguiente paso.

### P1-T003 — Marcar baseline como aplicado en public

`public` ya tiene todas las tablas. Registrar el baseline para
que el propagador no intente aplicarlo:

```sql
-- Reemplazar '0000_baseline.sql' con el nombre exacto del archivo
INSERT INTO public.schema_migrations (schema_name, filename)
VALUES ('public', '0000_baseline.sql')
ON CONFLICT DO NOTHING;
```

### P1-T004 — Crear el propagador de migraciones

**Archivo nuevo:** `server/provision/migrate-tenants.ts`

```typescript
/**
 * server/provision/migrate-tenants.ts
 *
 * Propagador de migraciones multi-tenant.
 * Lee todos los archivos en /migrations, compara contra
 * public.schema_migrations, y aplica los pendientes en orden
 * a cada schema de tenant activo.
 *
 * Se ejecuta automáticamente en cada startup del servidor.
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

/** Retorna archivos .sql en orden cronológico (por prefijo numérico). */
function getMigrationFiles(): string[] {
  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
}

/** Retorna los filenames ya aplicados en un schema. */
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

/** Aplica un archivo SQL en un schema. Envuelve en transacción. */
async function applyMigration(
  schemaName: string,
  filename: string,
  sql: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // search_path dirige los CREATE TABLE sin schema explícito al tenant correcto
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

/**
 * Propaga migraciones pendientes.
 * @param targetSchema  Si se especifica, solo migra ese schema.
 *                      Si es undefined, migra todos los tenants ACTIVE.
 */
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

/** Retorna el estado de migraciones de todos los tenants. Usado por superadmin. */
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
    `SELECT id, slug, schema_name, plan FROM public.tenants
     WHERE is_active = true ORDER BY created_at`
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
        appliedCount,
        pendingCount,
        lastAppliedAt: rows[0].last_applied,
        isUpToDate: pendingCount === 0,
      };
    })
  );

  return { totalFiles, tenants: result };
}
```

### P1-T005 — Actualizar server/index.ts

**Archivo:** `server/index.ts`

Agregar import al inicio (junto a los imports existentes):

```typescript
import { propagateMigrations } from "./provision/migrate-tenants";
```

En la IIFE async (línea ~130), agregar ANTES de `ensureSystemPermissions()`:

```typescript
(async () => {
  // Propagar migraciones pendientes a todos los tenants activos
  try {
    await propagateMigrations();
  } catch (err: any) {
    console.error("[migrate] Error en propagación:", err.message);
    // No bloquear startup — un tenant desactualizado es mejor que el servidor caído
  }

  await ensureSystemPermissions();
  await seedExtraTypes();
  await registerRoutes(httpServer, app);
  // ... resto sin cambios
```

### P1-T006 — Crear script run-migrate para desarrollo

**Archivo nuevo:** `server/provision/run-migrate.ts`

```typescript
/**
 * server/provision/run-migrate.ts
 * Aplica migraciones pendientes en el schema public (Tenant 1).
 * Uso: npm run db:migrate
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Asegurar que existe la tabla de control
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
```

### P1-T007 — Actualizar package.json

**Archivo:** `package.json`

En la sección `"scripts"`, reemplazar `db:push` y agregar los nuevos:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "npx tsx server/provision/run-migrate.ts",
"db:push": "echo DEPRECADO: usar db:generate seguido de db:migrate && exit 1",
```

---

## PARTE 2 — SEQUENCES DE NUMERACIÓN POR TENANT

### P2-T001 — Agregar campos a shared/schema.ts

**Archivo:** `shared/schema.ts`

Localizar `businessConfig` (línea ~960). Agregar al final de la
definición de columnas, antes del cierre `}`):

```typescript
orderDailyStart:  integer("order_daily_start").default(1).notNull(),
orderGlobalStart: integer("order_global_start").default(1).notNull(),
invoiceStart:     integer("invoice_start").default(1).notNull(),
```

### P2-T002 — Generar y aplicar migración para los nuevos campos

```bash
npx drizzle-kit generate --name=business_config_sequences
npm run db:migrate
```

Esto genera el `ALTER TABLE` correcto y lo aplica en `public`.
Al próximo restart del servidor, el propagador lo aplica en todos
los tenants activos automáticamente.

### P2-T003 — Actualizar createOrder en server/storage.ts

**Archivo:** `server/storage.ts`

Localizar `createOrder` (línea ~537). Reemplazar completamente:

```typescript
export async function createOrder(data: InsertOrder) {
  // Leer configuración de sequences del tenant desde business_config
  const config = await db.select({
    orderDailyStart:  businessConfig.orderDailyStart,
    orderGlobalStart: businessConfig.orderGlobalStart,
  }).from(businessConfig).limit(1);

  const dailyStart  = config[0]?.orderDailyStart  ?? 1;
  const globalStart = config[0]?.orderGlobalStart ?? 1;

  // dailyNumber: MAX del día + 1, con piso en dailyStart
  const dailyMax = await db.select({
    max: sql<number>`COALESCE(MAX(${orders.dailyNumber}), 0)`
  }).from(orders).where(eq(orders.businessDate, data.businessDate));

  const dailyNumber = Math.max((dailyMax[0]?.max || 0) + 1, dailyStart);

  // globalNumber: MAX global + 1, con piso en globalStart
  const globalMax = await db.select({
    max: sql<number>`COALESCE(MAX(${orders.globalNumber}), 0)`
  }).from(orders);

  const globalNumber = Math.max((globalMax[0]?.max || 0) + 1, globalStart);

  const [order] = await db.insert(orders)
    .values({ ...data, dailyNumber, globalNumber })
    .returning();
  return order;
}
```

Verificar que `businessConfig` está importado desde `@shared/schema`
al inicio del archivo. Si no está, agregar al bloque de imports.

### P2-T004 — Actualizar provision-service.ts para sequences

**Archivo:** `server/provision/provision-service.ts`

#### 4a — Actualizar interfaces

Reemplazar `CreateTenantInput`:

```typescript
export interface CreateTenantInput {
  slug: string;
  businessName: string;
  plan: "TRIAL" | "BASIC" | "PRO" | "ENTERPRISE";
  billingEmail: string;
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
  actorId?: number;
  orderDailyStart?:  number;
  orderGlobalStart?: number;
  invoiceStart?:     number;
}
```

Agregar nueva interface `ReprovisionInput` (después de `CreateTenantInput`):

```typescript
export interface ReprovisionInput {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
  actorId?: number;
  orderDailyStart?:  number;
  orderGlobalStart?: number;
  invoiceStart?:     number;
}
```

#### 4b — Actualizar seedTenant para recibir sequences

Localizar `async function seedTenant`. Cambiar firma y el INSERT
de `business_config`:

```typescript
async function seedTenant(
  schemaName: string,
  businessName: string,
  sequences?: {
    orderDailyStart?:  number;
    orderGlobalStart?: number;
    invoiceStart?:     number;
  }
) {
  const dailyStart  = sequences?.orderDailyStart  ?? 1;
  const globalStart = sequences?.orderGlobalStart ?? 1;
  const invStart    = sequences?.invoiceStart     ?? 1;

  await publicPool.query(
    `INSERT INTO "${schemaName}".business_config
       (business_name, legal_note, order_daily_start, order_global_start, invoice_start)
     VALUES ($1, 'Gracias por su preferencia', $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [businessName, dailyStart, globalStart, invStart]
  );

  // Resto del seed sin cambios (payment_methods, categories, hr_settings, perms)
```

#### 4c — Actualizar llamadas a seedTenant en createTenant

Localizar `await seedTenant(schemaName, input.businessName)` y reemplazar:

```typescript
await seedTenant(schemaName, input.businessName, {
  orderDailyStart:  input.orderDailyStart,
  orderGlobalStart: input.orderGlobalStart,
  invoiceStart:     input.invoiceStart,
});
```

---

## PARTE 3 — RE-PROVISIONAMIENTO

### P3-T001 — Actualizar runMigrations en provision-service.ts

**Archivo:** `server/provision/provision-service.ts`

Agregar import al inicio:

```typescript
import { propagateMigrations } from "./migrate-tenants";
```

Localizar la función `runMigrations` (línea ~192). Reemplazar
**completamente** con esta versión que usa el sistema de archivos:

```typescript
async function runMigrations(schemaName: string): Promise<void> {
  // El propagador aplica todos los archivos .sql desde migrations/
  // en orden, registrando cada uno en schema_migrations.
  // Esto garantiza que el nuevo tenant tiene exactamente la misma
  // estructura que todos los demás — ni más ni menos.
  await propagateMigrations(schemaName);
}
```

### P3-T002 — Agregar reprovisionTenant

**Archivo:** `server/provision/provision-service.ts`

Agregar esta función DESPUÉS de `reactivateTenant` y ANTES de
`changeTenantPlan`:

```typescript
export async function reprovisionTenant(tenantId: number, input: ReprovisionInput) {
  const { rows } = await publicPool.query(
    `SELECT id, slug, schema_name, plan, status, business_name
     FROM public.tenants WHERE id = $1`,
    [tenantId]
  );
  if (rows.length === 0) throw new Error(`Tenant ${tenantId} no encontrado`);

  const tenant = rows[0];
  if (tenant.status !== "FAILED") {
    throw new Error(
      `Solo se puede re-provisionar tenants FAILED. Status actual: ${tenant.status}`
    );
  }

  const schemaName: string = tenant.schema_name;

  await publicPool.query(
    `INSERT INTO public.provision_log (tenant_id, action, actor_id, status, metadata)
     VALUES ($1, 'REPROVISION', $2, 'STARTED', $3)`,
    [tenantId, input.actorId || null,
     JSON.stringify({ slug: tenant.slug, plan: tenant.plan })]
  );

  try {
    await publicPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    console.log(`[reprovision] Schema "${schemaName}" eliminado`);

    await publicPool.query(
      `UPDATE public.tenants SET status='PROVISIONING', is_active=false,
       updated_at=NOW() WHERE id=$1`,
      [tenantId]
    );

    await publicPool.query(`CREATE SCHEMA "${schemaName}"`);
    console.log(`[reprovision] Schema "${schemaName}" re-creado`);

    await runMigrations(schemaName);
    await seedTenant(schemaName, tenant.business_name, {
      orderDailyStart:  input.orderDailyStart,
      orderGlobalStart: input.orderGlobalStart,
      invoiceStart:     input.invoiceStart,
    });
    await createAdminUser(schemaName, {
      email: input.adminEmail,
      password: input.adminPassword,
      displayName: input.adminDisplayName,
    });
    await activatePlanModules(tenantId, tenant.plan);

    await publicPool.query(
      `UPDATE public.tenants SET status='ACTIVE', is_active=true,
       updated_at=NOW() WHERE id=$1`,
      [tenantId]
    );
    await publicPool.query(
      `UPDATE public.provision_log SET status='COMPLETED'
       WHERE tenant_id=$1 AND action='REPROVISION' AND status='STARTED'`,
      [tenantId]
    );

    console.log(`[reprovision] Tenant "${tenant.slug}" re-provisionado ✓`);
    const result = (await publicPool.query(
      `SELECT id, slug, schema_name, plan, status, is_active
       FROM public.tenants WHERE id=$1`,
      [tenantId]
    )).rows[0];

    return {
      id: result.id, slug: result.slug, schemaName: result.schema_name,
      plan: result.plan, status: result.status, isActive: result.is_active,
    };
  } catch (err: any) {
    console.error(`[reprovision] ERROR:`, err.message);
    try {
      await publicPool.query(
        `UPDATE public.tenants SET status='FAILED', updated_at=NOW() WHERE id=$1`,
        [tenantId]
      );
      await publicPool.query(
        `UPDATE public.provision_log SET status='FAILED', error_message=$1
         WHERE tenant_id=$2 AND action='REPROVISION' AND status='STARTED'`,
        [err.message, tenantId]
      );
    } catch (_) {}
    throw err;
  }
}
```

### P3-T003 — Endpoint de re-provisionamiento

**Archivo:** `server/provision/provision-routes.ts`

Agregar imports:

```typescript
import {
  createTenant, suspendTenant, reactivateTenant,
  changeTenantPlan, validateSlug,
  reprovisionTenant,
  type ReprovisionInput,
} from "./provision-service";
```

Agregar endpoint DESPUÉS de `POST /api/superadmin/tenants/:id/reactivate`:

```typescript
router.post("/tenants/:id/reprovision", async (req, res) => {
  try {
    const tenantId = parseInt(req.params.id);
    const {
      adminEmail, adminPassword, adminDisplayName,
      orderDailyStart, orderGlobalStart, invoiceStart,
    } = req.body;

    if (!adminEmail || !adminPassword || !adminDisplayName) {
      return res.status(400).json({
        message: "adminEmail, adminPassword y adminDisplayName son requeridos"
      });
    }

    const result = await reprovisionTenant(tenantId, {
      adminEmail, adminPassword, adminDisplayName,
      actorId: (req as any).superadminId || undefined,
      orderDailyStart:  orderDailyStart  ? parseInt(orderDailyStart)  : undefined,
      orderGlobalStart: orderGlobalStart ? parseInt(orderGlobalStart) : undefined,
      invoiceStart:     invoiceStart     ? parseInt(invoiceStart)     : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
```

Actualizar también el endpoint `POST /api/superadmin/tenants` (crear
tenant nuevo) para recibir los mismos campos de sequence:

```typescript
// Agregar al destructuring del body:
const {
  slug, businessName, plan, billingEmail,
  adminEmail, adminPassword, adminDisplayName,
  orderDailyStart, orderGlobalStart, invoiceStart,
} = req.body;

// Agregar al objeto input:
orderDailyStart:  orderDailyStart  ? parseInt(orderDailyStart)  : undefined,
orderGlobalStart: orderGlobalStart ? parseInt(orderGlobalStart) : undefined,
invoiceStart:     invoiceStart     ? parseInt(invoiceStart)     : undefined,
```

---

## PARTE 4 — DASHBOARD DE VERSIONES EN SUPERADMIN

### P4-T001 — Endpoint de estado de migraciones

**Archivo:** `server/provision/provision-routes.ts`

Agregar import:

```typescript
import { getMigrationStatus } from "./migrate-tenants";
```

Agregar endpoint GET:

```typescript
router.get("/migration-status", async (_req, res) => {
  try {
    const status = await getMigrationStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

### P4-T002 — Tab "Schema" en superadmin UI

**Archivo:** `client/src/pages/superadmin.tsx`

#### Estado y query

Agregar junto a los otros estados del componente:

```typescript
const [activeTab, setActiveTab] = useState<"tenants" | "schema">("tenants");

const { data: migrationStatus, refetch: refetchMigrations } = useQuery({
  queryKey: ["migration-status"],
  queryFn: async () => {
    const res = await fetch("/api/superadmin/migration-status", {
      headers: { "x-superadmin-token": superadminToken },
    });
    if (!res.ok) throw new Error("Error al obtener estado de migraciones");
    return res.json();
  },
  enabled: activeTab === "schema",
  refetchInterval: 30000,
});
```

#### Navegación por tabs

Localizar el área del header o la navegación principal del superadmin.
Agregar selector de tabs junto a donde está el título:

```tsx
<div className="flex gap-1 border-b mb-4">
  <button
    onClick={() => setActiveTab("tenants")}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "tenants"
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-gray-500 hover:text-gray-700"
    }`}
  >
    Tenants
  </button>
  <button
    onClick={() => setActiveTab("schema")}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "schema"
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-gray-500 hover:text-gray-700"
    }`}
  >
    Versiones de Schema
    {migrationStatus?.tenants?.some((t: any) => !t.isUpToDate) && (
      <span className="ml-2 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
        ⚠
      </span>
    )}
  </button>
</div>
```

#### Panel de versiones de schema

Agregar condicionalmente cuando `activeTab === "schema"`:

```tsx
{activeTab === "schema" && (
  <div className="space-y-4">
    {/* Resumen global */}
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-semibold text-gray-800">Estado de Migraciones</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Total de archivos de migración: {migrationStatus?.totalFiles ?? "—"}
        </p>
      </div>
      <button
        onClick={() => refetchMigrations()}
        className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
      >
        🔄 Actualizar
      </button>
    </div>

    {/* Alerta si hay tenants desincronizados */}
    {migrationStatus?.tenants?.some((t: any) => !t.isUpToDate) && (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        ⚠ Hay tenants con migraciones pendientes. Se aplicarán
        automáticamente en el próximo restart del servidor.
      </div>
    )}

    {/* Tabla de estado por tenant */}
    {!migrationStatus ? (
      <div className="text-sm text-gray-400 text-center py-8">Cargando...</div>
    ) : (
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Plan</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Schema</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Aplicadas</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Pendientes</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Última migración</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {migrationStatus.tenants.map((t: any) => (
              <tr key={t.tenantId} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{t.slug}</td>
                <td className="px-4 py-3 text-gray-500">{t.plan}</td>
                <td className="px-4 py-3 text-center font-mono text-xs text-gray-400">
                  {t.schemaName}
                </td>
                <td className="px-4 py-3 text-center">
                  {t.appliedCount} / {migrationStatus.totalFiles}
                </td>
                <td className="px-4 py-3 text-center">
                  {t.pendingCount > 0 ? (
                    <span className="font-semibold text-amber-600">{t.pendingCount}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {t.lastAppliedAt
                    ? new Date(t.lastAppliedAt).toLocaleString("es-CR")
                    : "—"}
                </td>
                <td className="px-4 py-3 text-center">
                  {t.isUpToDate ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      ✓ Al día
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      ⚠ Pendiente
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {/* Nota informativa */}
    <p className="text-xs text-gray-400">
      Las migraciones pendientes se aplican automáticamente en cada
      restart/deploy del servidor. Para forzar aplicación inmediata,
      reiniciar el servidor desde el panel de Replit o Railway.
    </p>
  </div>
)}
```

#### Sección de numeración en formulario de creación y re-provisionamiento

En el formulario de creación de tenant (donde están los campos de
slug, plan, adminEmail, etc.), agregar sección de numeración inicial
después de los campos del admin:

```tsx
<div className="border-t pt-4 mt-2">
  <p className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
    Numeración inicial
  </p>
  <p className="text-xs text-gray-400 mb-3">
    Configura desde qué número arranca el sistema. Útil si el cliente
    ya opera y quiere continuidad en sus consecutivos.
  </p>
  <div className="grid grid-cols-3 gap-3">
    {[
      { key: "orderDailyStart",  label: "Orden diaria" },
      { key: "orderGlobalStart", label: "Orden global" },
      { key: "invoiceStart",     label: "Factura" },
    ].map(({ key, label }) => (
      <div key={key}>
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <input
          type="number" min="1"
          value={(createForm as any)[key] ?? 1}
          onChange={e => setCreateForm((f: any) => ({
            ...f, [key]: parseInt(e.target.value) || 1
          }))}
          className="w-full mt-1 border rounded px-2 py-1.5 text-sm"
        />
      </div>
    ))}
  </div>
</div>
```

Agregar los tres campos al estado inicial de `createForm`:
```typescript
orderDailyStart: 1,
orderGlobalStart: 1,
invoiceStart: 1,
```

Y al body del fetch de creación:
```typescript
orderDailyStart:  createForm.orderDailyStart,
orderGlobalStart: createForm.orderGlobalStart,
invoiceStart:     createForm.invoiceStart,
```

Hacer lo mismo en el dialog de re-provisionamiento — agregar la
misma sección de 3 campos y pasarlos en el body del fetch.

---

## PARTE 5 — ADMIN PANEL: NUMERACIÓN EDITABLE POR EL TENANT

**Archivo:** `client/src/pages/admin/business-config.tsx`

Agregar sección "Numeración de Órdenes" al formulario, antes del
"Danger Zone". Incluir los tres campos `orderDailyStart`,
`orderGlobalStart`, `invoiceStart` con inputs tipo number.

Verificar que el PUT de business_config incluye los tres campos
nuevos en el body, y que el GET los retorna (si el backend tiene
SELECT explícito de columnas, agregar los tres campos nuevos).

---

## VERIFICACIÓN FINAL — EN ORDEN ESTRICTO

```bash
# 1. Verificar que el baseline fue generado
ls -la migrations/

# 2. Sin errores TypeScript
npx tsc --noEmit

# 3. Verificar que db:push está bloqueado
npm run db:push
# Debe mostrar: "DEPRECADO: usar db:generate seguido de db:migrate"

# 4. Verificar estado en DB
psql $DATABASE_URL -c "SELECT * FROM public.schema_migrations;"
# Debe mostrar al menos: public | 0000_baseline.sql

# 5. Reiniciar servidor y verificar log de startup:
# [migrate] X archivo(s) → N schema(s)
# [migrate] Propagación completada ✓

# 6. Test end-to-end: crear tenant de prueba desde superadmin UI
# Verificar en DB:
# SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'tenant_XXXXXXXX';
# Debe ser igual al conteo de public (sin las tablas globales)

# 7. Verificar tab "Versiones de Schema" en superadmin muestra datos

# 8. Re-provisionar tenant 2 (FAILED) desde el botón en superadmin
# Verificar que queda ACTIVE con todas las tablas
```

---

## FLUJO DE TRABAJO NUEVO — REFERENCIA PERMANENTE

```
DESARROLLO:
  1. Editar shared/schema.ts
  2. npm run db:generate   → crea migrations/NNNN_nombre.sql
  3. npm run db:migrate    → aplica en public (Tenant 1 / dev)
  4. Continuar desarrollo

DEPLOY (automático en restart):
  propagateMigrations() en server/index.ts
  → aplica archivos nuevos en todos los tenants activos
  → registra en schema_migrations

NUEVO TENANT:
  runMigrations(schemaName) en provision-service.ts
  → llama propagateMigrations(schemaName)
  → aplica TODOS los archivos desde baseline
  → tenant queda con estructura completa y al día
```
