# RMSCore — Registrar Tenant de Producción (Restaurante La Antigua)

## CONTEXTO
El sistema multi-tenant ya está instalado (shared/schema-public.ts, server/middleware/tenant.ts, etc.).
El restaurante actual opera sobre el schema `public` de PostgreSQL y tiene TODOS sus datos ahí.
Necesitamos registrar este restaurante como **Tenant 1** sin mover ni tocar ningún dato existente,
y asegurar que tanto el ambiente de desarrollo (Replit) como el futuro ambiente de producción (Railway)
funcionen idéntico.

## OBJETIVO
1. Crear las tablas globales multi-tenant en la base de datos (idempotente — no rompe nada)
2. Registrar el restaurante actual como Tenant 1 apuntando al schema `public`
3. Activar todos los módulos del plan PRO para este tenant
4. Verificar que el sistema sigue funcionando exactamente igual que antes

## INSTRUCCIONES GENERALES
- NO modificar shared/schema.ts
- NO modificar server/db.ts
- NO modificar server/routes.ts (a menos que se indique explícitamente)
- NO mover ni alterar ningún dato existente
- Todas las operaciones son idempotentes (se pueden ejecutar múltiples veces sin problema)

---

## PASO 1 — Crear el archivo de seed del tenant propio

Crear el archivo `server/provision/seed-own-tenant.ts` con este contenido EXACTO:

```typescript
/**
 * server/provision/seed-own-tenant.ts
 *
 * Registra el restaurante propio (La Antigua) como Tenant 1.
 * Apunta al schema 'public' donde ya viven todos los datos existentes.
 * Operación 100% idempotente — se puede ejecutar múltiples veces sin riesgo.
 */

import { pool } from "../db";

const OWN_TENANT = {
  slug:          "rest-la-antigua",
  businessName:  "Restaurante La Antigua",
  schemaName:    "public",
  plan:          "PRO",
  billingEmail:  "admin@restlaantigua.com",
};

// Todos los módulos activos en plan PRO
const PRO_MODULES = [
  "CORE_TABLES",
  "CORE_POS",
  "CORE_QR",
  "CORE_DASHBOARD",
  "MOD_INVENTORY",
  "MOD_HR",
  "MOD_RESERVATIONS",
  "MOD_LOYALTY",
  "MOD_ANALYTICS",
];

export async function ensurePublicTables(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("[tenant-seed] Verificando tablas globales multi-tenant...");

    // ── Tabla: tenants ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id               SERIAL PRIMARY KEY,
        slug             VARCHAR(100) NOT NULL UNIQUE,
        business_name    VARCHAR(200) NOT NULL,
        schema_name      VARCHAR(63)  NOT NULL UNIQUE,
        plan             VARCHAR(20)  NOT NULL DEFAULT 'TRIAL',
        status           VARCHAR(30)  NOT NULL DEFAULT 'ACTIVE',
        is_active        BOOLEAN      NOT NULL DEFAULT true,
        trial_ends_at    TIMESTAMP,
        suspended_at     TIMESTAMP,
        suspend_reason   TEXT,
        billing_email    VARCHAR(200),
        stripe_customer_id VARCHAR(100),
        onboarding_file_url TEXT,
        created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    // ── Tabla: tenant_modules ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_modules (
        id            SERIAL PRIMARY KEY,
        tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_key    VARCHAR(50) NOT NULL,
        is_active     BOOLEAN NOT NULL DEFAULT true,
        price         NUMERIC(10,2) NOT NULL DEFAULT 0,
        billing_type  VARCHAR(20) NOT NULL DEFAULT 'FIXED',
        unit_count    INTEGER DEFAULT 0,
        activated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, module_key)
      )
    `);

    // ── Tabla: provision_log ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS provision_log (
        id            SERIAL PRIMARY KEY,
        tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        action        VARCHAR(50) NOT NULL,
        actor_id      INTEGER,
        status        VARCHAR(20) NOT NULL DEFAULT 'STARTED',
        error_message TEXT,
        metadata      JSONB,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── Tabla: superadmin_users ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS superadmin_users (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(200) NOT NULL,
        role          VARCHAR(20)  NOT NULL DEFAULT 'SUPPORT',
        last_login_at TIMESTAMP,
        created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    // ── Tabla: billing_events ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_events (
        id               SERIAL PRIMARY KEY,
        tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type       VARCHAR(50) NOT NULL,
        amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
        description      TEXT,
        billing_date     DATE NOT NULL DEFAULT CURRENT_DATE,
        stripe_invoice_id VARCHAR(100),
        status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log("[tenant-seed] ✓ Tablas globales verificadas/creadas");

    // ── Registrar Tenant 1 (el restaurante propio) ──────────────────────────
    const existing = await client.query(
      `SELECT id FROM tenants WHERE slug = $1`,
      [OWN_TENANT.slug]
    );

    let tenantId: number;

    if (existing.rows.length === 0) {
      const res = await client.query(`
        INSERT INTO tenants
          (slug, business_name, schema_name, plan, status, is_active, billing_email, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'ACTIVE', true, $5, NOW(), NOW())
        RETURNING id
      `, [
        OWN_TENANT.slug,
        OWN_TENANT.businessName,
        OWN_TENANT.schemaName,
        OWN_TENANT.plan,
        OWN_TENANT.billingEmail,
      ]);
      tenantId = res.rows[0].id;
      console.log(`[tenant-seed] ✓ Tenant 1 registrado: ${OWN_TENANT.businessName} (id=${tenantId})`);
    } else {
      tenantId = existing.rows[0].id;
      console.log(`[tenant-seed] ✓ Tenant 1 ya existe (id=${tenantId}) — sin cambios`);
    }

    // ── Activar módulos PRO ─────────────────────────────────────────────────
    for (const moduleKey of PRO_MODULES) {
      await client.query(`
        INSERT INTO tenant_modules (tenant_id, module_key, is_active, price, billing_type)
        VALUES ($1, $2, true, 0, 'FIXED')
        ON CONFLICT (tenant_id, module_key) DO NOTHING
      `, [tenantId, moduleKey]);
    }
    console.log(`[tenant-seed] ✓ ${PRO_MODULES.length} módulos PRO activados para Tenant 1`);

    // ── Actualizar variable de entorno TENANT_ID si es necesario ───────────
    // El middleware ya usa TENANT_SCHEMA=public para dev, esto es informativo
    console.log(`[tenant-seed] ✓ Tenant 1 listo. TENANT_ID=${tenantId}, TENANT_SCHEMA=public`);

  } catch (err: any) {
    console.error("[tenant-seed] ERROR:", err.message);
    throw err;
  } finally {
    client.release();
  }
}
```

---

## PASO 2 — Modificar `server/index.ts`

Buscar en `server/index.ts` la función que se llama cerca del arranque del servidor (después de las importaciones, antes o después de `registerRoutes`).

### 2a — Agregar el import al inicio del archivo

Buscar el bloque de imports existente y agregar esta línea:

```typescript
import { ensurePublicTables } from "./provision/seed-own-tenant";
```

### 2b — Llamar ensurePublicTables al arrancar

Buscar donde dice `registerRoutes(app)` o la función que inicia el servidor.
Agregar `ensurePublicTables()` ANTES de `registerRoutes`.

El resultado debe verse así:

```typescript
// Asegurar tablas globales multi-tenant y registrar Tenant 1
ensurePublicTables().catch(err => {
  console.error("[startup] Error en tenant seed:", err.message);
  // No detener el servidor si falla el seed
});

// ... registerRoutes(app) continúa aquí
```

**IMPORTANTE:** Usar `.catch()` y no `await` para no bloquear el arranque del servidor.
El servidor debe estar operativo aunque el seed tarde unos segundos.

---

## PASO 3 — Verificar secrets de Replit

Confirmar que estos tres secrets existen en Replit → Secrets:

```
TENANT_SCHEMA = public
TENANT_ID     = 1
SUPERADMIN_TOKEN = rmscore-superadmin-2026
```

Si no existen, crearlos con esos valores exactos.

---

## PASO 4 — Verificar que el middleware de tenant está en modo dev correcto

Abrir `server/middleware/tenant.ts` y confirmar que el bloque de desarrollo usa la variable de entorno.
Debe haber algo como:

```typescript
// Modo desarrollo: usar schema de variable de entorno
if (process.env.TENANT_SCHEMA) {
  req.tenantSchema = process.env.TENANT_SCHEMA; // "public"
  return next();
}
```

Si ese bloque NO existe, agregarlo al inicio de la función del middleware, antes de la lógica de subdominio.

---

## PASO 5 — Reiniciar el servidor

Hacer restart del workflow. Al arrancar, los logs deben mostrar:

```
[tenant-seed] Verificando tablas globales multi-tenant...
[tenant-seed] ✓ Tablas globales verificadas/creadas
[tenant-seed] ✓ Tenant 1 registrado: Restaurante La Antigua (id=1)
[tenant-seed] ✓ 9 módulos PRO activados para Tenant 1
[tenant-seed] ✓ Tenant 1 listo. TENANT_ID=1, TENANT_SCHEMA=public
```

O si ya existe:
```
[tenant-seed] ✓ Tenant 1 ya existe (id=1) — sin cambios
```

---

## PASO 6 — Verificación final

Ejecutar estas comprobaciones:

1. **App funciona igual:** Navegar a `/` → debe mostrar el login PIN como siempre
2. **POS funciona:** Navegar a `/pos` → debe cargar las mesas con órdenes abiertas
3. **Superadmin funciona:** Navegar a `/superadmin` → debe mostrar la pantalla de login de token
4. **Tenant aparece en superadmin:** Ingresar token `rmscore-superadmin-2026` → en la lista de tenants debe aparecer "Restaurante La Antigua" con plan PRO y estado Activo

---

## CRITERIO DE ÉXITO

✓ El servidor arranca sin errores  
✓ Los logs muestran "[tenant-seed] ✓ Tenant 1 listo"  
✓ El login PIN funciona igual que antes  
✓ El POS y las mesas cargan correctamente  
✓ `/superadmin` muestra el tenant con plan PRO  
✓ No hay errores de TypeScript ni de runtime  

---

## NOTA SOBRE PRODUCCIÓN (Railway)

Cuando se migre a Railway, este mismo código se ejecutará automáticamente al arrancar.
El dump de PostgreSQL de Replit incluirá las tablas `tenants` y `tenant_modules` ya con
el Tenant 1 registrado. El seed verificará que ya existe y no hará nada (idempotente).
Solo hay que asegurarse de que Railway tenga los mismos secrets:
```
TENANT_SCHEMA = public
TENANT_ID     = 1
SUPERADMIN_TOKEN = rmscore-superadmin-2026
```
No se requiere ningún paso manual adicional en producción.
