/**
 * server/provision/seed-own-tenant.ts
 *
 * Registra el restaurante propio (La Antigua) como Tenant 1.
 * Apunta al schema 'tenant_la_antigua' donde viven los datos del tenant.
 * Operación 100% idempotente — se puede ejecutar múltiples veces sin riesgo.
 */

import { pool } from "../db";

const OWN_TENANT = {
  slug:          "rms",
  businessName:  "Restaurante y Granja La Antigua Lechería",
  schemaName:    "tenant_la_antigua",
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
      `SELECT id FROM tenants WHERE slug = $1 OR schema_name = $2 LIMIT 1`,
      [OWN_TENANT.slug, OWN_TENANT.schemaName]
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
    console.log(`[tenant-seed] ✓ Tenant 1 listo. TENANT_ID=${tenantId}, TENANT_SCHEMA=${OWN_TENANT.schemaName}`);

  } catch (err: any) {
    console.error("[tenant-seed] ERROR:", err.message);
    throw err;
  } finally {
    client.release();
  }
}