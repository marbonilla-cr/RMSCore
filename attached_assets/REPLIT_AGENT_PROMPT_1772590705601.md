# RMSCore — Multi-Tenant + Dispatch Mode (Modelo 3)

## CONTEXTO
Este es el sistema RMSCore, un restaurant management system en producción. Vamos a agregar tres capacidades nuevas sin romper nada que ya funcione:

1. **Capa multi-tenant** — arquitectura de base para soportar múltiples restaurantes
2. **Provision Module** — API para crear y gestionar clientes (tenants)
3. **Modelo 3: Dispatch** — el cliente ordena desde QR, la orden va directo a cocina, y recibe notificación en su teléfono cuando está lista

El sistema actual sigue funcionando exactamente igual durante y después de estos cambios. La capa multi-tenant está "dormida" en desarrollo — se activa solo cuando se configure un subdominio real en producción.

---

## INSTRUCCIONES GENERALES

- NO modificar nada que no esté explícitamente indicado en este prompt
- NO cambiar shared/schema.ts, server/db.ts, server/storage.ts ni ningún archivo existente que no se mencione
- Crear los archivos nuevos EXACTAMENTE con el contenido que se especifica abajo
- Hacer los cambios puntuales en routes.ts e index.ts que se listan en la sección "CAMBIOS EN ARCHIVOS EXISTENTES"
- Agregar los 3 secrets indicados en las variables de entorno de Replit
- Al terminar, reiniciar el servidor y verificar que no hay errores de TypeScript ni de runtime

---

## PASO 1 — SECRETS (Replit → Secrets)

Agregar estas tres variables de entorno:

```
TENANT_SCHEMA=public
TENANT_ID=1
SUPERADMIN_TOKEN=rmscore-superadmin-2026
```

---

## PASO 2 — ARCHIVOS NUEVOS A CREAR

Crear cada archivo en la ruta exacta indicada con el contenido completo que se especifica.

---

### ARCHIVO 1: `shared/schema-public.ts`

```typescript
/**
 * shared/schema-public.ts
 * Tablas del schema PUBLIC de PostgreSQL.
 * Estas tablas son globales — no pertenecen a ningún tenant.
 * NO modificar shared/schema.ts — este es un archivo separado.
 */

import {
  pgTable, text, integer, boolean, timestamp, serial, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const tenants = pgTable("tenants", {
  id:               serial("id").primaryKey(),
  slug:             text("slug").notNull().unique(),
  businessName:     text("business_name").notNull(),
  schemaName:       text("schema_name").notNull().unique(),
  plan:             text("plan").notNull().default("TRIAL"),
  status:           text("status").notNull().default("PROVISIONING"),
  isActive:         boolean("is_active").notNull().default(false),
  trialEndsAt:      timestamp("trial_ends_at"),
  suspendedAt:      timestamp("suspended_at"),
  suspendReason:    text("suspend_reason"),
  billingEmail:     text("billing_email"),
  stripeCustomerId: text("stripe_customer_id"),
  onboardingFileUrl:text("onboarding_file_url"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;
export const insertTenantSchema = createInsertSchema(tenants);

export const tenantModules = pgTable("tenant_modules", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenant_id").notNull().references(() => tenants.id),
  moduleKey:    text("module_key").notNull(),
  isActive:     boolean("is_active").notNull().default(true),
  activatedAt:  timestamp("activated_at").notNull().defaultNow(),
  deactivatedAt:timestamp("deactivated_at"),
  price:        integer("price").notNull().default(0),
  billingType:  text("billing_type").notNull().default("FIXED"),
  unitCount:    integer("unit_count").default(0),
  notes:        text("notes"),
});

export type TenantModule = typeof tenantModules.$inferSelect;

export const superadminUsers = pgTable("superadmin_users", {
  id:           serial("id").primaryKey(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("SUPPORT"),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const provisionLog = pgTable("provision_log", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenant_id").references(() => tenants.id),
  action:       text("action").notNull(),
  actorId:      integer("actor_id"),
  status:       text("status").notNull(),
  errorMessage: text("error_message"),
  metadata:     jsonb("metadata"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const billingEvents = pgTable("billing_events", {
  id:             serial("id").primaryKey(),
  tenantId:       integer("tenant_id").notNull().references(() => tenants.id),
  eventType:      text("event_type").notNull(),
  amount:         integer("amount").notNull(),
  description:    text("description").notNull(),
  billingDate:    timestamp("billing_date").notNull().defaultNow(),
  stripeInvoiceId:text("stripe_invoice_id"),
  status:         text("status").notNull().default("PENDING"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const PLAN_MODULES: Record<string, string[]> = {
  TRIAL:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  BASIC:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  PRO:        ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS"],
  ENTERPRISE: ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS","MOD_QBO","MOD_MULTI_LOCATION","MOD_API"],
};

export const ADDON_PRICES: Record<string, { price: number; billingType: "FIXED" | "PER_UNIT"; label: string }> = {
  MOD_INVENTORY:     { price: 2500, billingType: "FIXED",    label: "Inventario completo" },
  MOD_HR:            { price: 500,  billingType: "PER_UNIT", label: "RRHH + Marcaciones (por empleado)" },
  MOD_RESERVATIONS:  { price: 1500, billingType: "FIXED",    label: "Reservaciones públicas" },
  MOD_LOYALTY:       { price: 2000, billingType: "FIXED",    label: "Loyalty / Puntos" },
  MOD_ANALYTICS:     { price: 2000, billingType: "FIXED",    label: "Sales Cube analytics" },
  MOD_QBO:           { price: 2000, billingType: "FIXED",    label: "QuickBooks Online" },
  MOD_MULTI_LOCATION:{ price: 0,    billingType: "FIXED",    label: "Multi-ubicación (consultar)" },
};

export const PLAN_PRICES: Record<string, { base: number; includedUsers: number; extraUserPrice: number }> = {
  TRIAL:      { base: 0,     includedUsers: 5,  extraUserPrice: 500 },
  BASIC:      { base: 5000,  includedUsers: 5,  extraUserPrice: 500 },
  PRO:        { base: 12000, includedUsers: 10, extraUserPrice: 500 },
  ENTERPRISE: { base: 25000, includedUsers: -1, extraUserPrice: 0   },
};
```

---

### ARCHIVO 2: `server/db-tenant.ts`

```typescript
/**
 * server/db-tenant.ts
 * Pool de conexión por tenant. NO modifica server/db.ts.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const dbCache = new Map<string, ReturnType<typeof drizzle>>();

export function getTenantDb(schemaName: string) {
  if (dbCache.has(schemaName)) return dbCache.get(schemaName)!;

  const tenantPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  tenantPool.on("connect", (client) => {
    client.query(`SET search_path TO "${schemaName}", public`);
  });

  const tenantDb = drizzle(tenantPool, { schema });
  dbCache.set(schemaName, tenantDb);
  console.log(`[db-tenant] Schema "${schemaName}" conectado`);
  return tenantDb;
}

export function evictTenantDb(schemaName: string) {
  dbCache.delete(schemaName);
}
```

---

### ARCHIVO 3: `server/middleware/tenant.ts`

```typescript
/**
 * server/middleware/tenant.ts
 *
 * EN DESARROLLO (Replit): lee TENANT_SCHEMA del .env → usa ese schema.
 * Con TENANT_SCHEMA=public el sistema funciona igual que antes.
 * EN PRODUCCIÓN: identifica tenant por subdominio.
 */

import type { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { getTenantDb } from "../db-tenant";

declare global {
  namespace Express {
    interface Request {
      tenantSchema: string;
      tenantId: number | null;
      db: ReturnType<typeof getTenantDb>;
    }
  }
}

let publicPool: Pool | null = null;
function getPublicPool(): Pool {
  if (!publicPool) publicPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return publicPool;
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const devSchema = process.env.TENANT_SCHEMA;
    if (devSchema) {
      req.tenantSchema = devSchema;
      req.tenantId = parseInt(process.env.TENANT_ID || "1");
      req.db = getTenantDb(devSchema);
      return next();
    }

    const host = req.hostname;
    const parts = host.split(".");
    if (parts.length < 3 || parts[0] === "admin" || parts[0] === "www") {
      req.tenantSchema = "public";
      req.tenantId = null;
      req.db = getTenantDb("public");
      return next();
    }

    const slug = parts[0];
    const result = await getPublicPool().query(
      `SELECT id, schema_name, is_active, status FROM public.tenants WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (!result.rows.length) return res.status(404).json({ message: "Restaurante no encontrado." });

    const tenant = result.rows[0];
    if (!tenant.is_active) {
      const msgs: Record<string, string> = {
        SUSPENDED: "Este restaurante está suspendido.",
        TRIAL_EXPIRED: "El período de prueba ha vencido.",
        EXPIRED: "La suscripción ha vencido.",
      };
      return res.status(403).json({ message: msgs[tenant.status] || "Acceso no disponible.", status: tenant.status });
    }

    req.tenantSchema = tenant.schema_name;
    req.tenantId = tenant.id;
    req.db = getTenantDb(tenant.schema_name);
    next();
  } catch (err: any) {
    console.error("[tenant-middleware] Error:", err.message);
    req.tenantSchema = process.env.TENANT_SCHEMA || "public";
    req.tenantId = null;
    req.db = getTenantDb(req.tenantSchema);
    next();
  }
}

export function requireModule(moduleKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) return next();
      const result = await getPublicPool().query(
        `SELECT is_active FROM public.tenant_modules WHERE tenant_id = $1 AND module_key = $2 LIMIT 1`,
        [req.tenantId, moduleKey]
      );
      if (!result.rows.length || !result.rows[0].is_active) {
        return res.status(403).json({ code: "MODULE_NOT_ACTIVE", module: moduleKey, message: "Este módulo no está incluido en tu plan actual." });
      }
      next();
    } catch (err: any) {
      console.error("[requireModule] Error:", err.message);
      next();
    }
  };
}
```

---

### ARCHIVO 4: `server/provision/provision-service.ts`

```typescript
/**
 * server/provision/provision-service.ts
 * Lógica core: crear, suspender, reactivar tenants con rollback automático.
 */

import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { PLAN_MODULES, ADDON_PRICES } from "@shared/schema-public";

const publicPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

export interface CreateTenantInput {
  slug: string;
  businessName: string;
  plan: "TRIAL" | "BASIC" | "PRO" | "ENTERPRISE";
  billingEmail: string;
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
  actorId?: number;
}

export function validateSlug(slug: string): string | null {
  if (!slug) return "El slug es requerido";
  if (slug.length > 50) return "Máximo 50 caracteres";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Solo letras minúsculas, números y guiones";
  if (slug.startsWith("-") || slug.endsWith("-")) return "No puede empezar ni terminar con guión";
  return null;
}

function generateSchemaName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return `tenant_${r}`;
}

export async function createTenant(input: CreateTenantInput) {
  let tenantId: number | null = null;
  let schemaName: string | null = null;
  let schemaCreated = false;

  try {
    const slugError = validateSlug(input.slug);
    if (slugError) throw new Error(slugError);

    const existing = await publicPool.query("SELECT id FROM public.tenants WHERE slug = $1", [input.slug]);
    if (existing.rows.length) throw new Error(`El slug "${input.slug}" ya está en uso`);

    schemaName = generateSchemaName();
    const trialEndsAt = input.plan === "TRIAL" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;

    const tenantResult = await publicPool.query(
      `INSERT INTO public.tenants (slug, business_name, schema_name, plan, status, is_active, trial_ends_at, billing_email)
       VALUES ($1,$2,$3,$4,'PROVISIONING',false,$5,$6) RETURNING id`,
      [input.slug, input.businessName, schemaName, input.plan, trialEndsAt, input.billingEmail]
    );
    tenantId = tenantResult.rows[0].id;

    await publicPool.query(
      `INSERT INTO public.provision_log (tenant_id, action, actor_id, status, metadata) VALUES ($1,'CREATE',$2,'STARTED',$3)`,
      [tenantId, input.actorId || null, JSON.stringify({ slug: input.slug, plan: input.plan })]
    );

    await publicPool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    schemaCreated = true;
    console.log(`[provision] Schema "${schemaName}" creado`);

    await runMigrations(schemaName);
    await seedTenant(schemaName, input.businessName);
    await createAdminUser(schemaName, { email: input.adminEmail, password: input.adminPassword, displayName: input.adminDisplayName });
    await activatePlanModules(tenantId, input.plan);

    await publicPool.query(
      `UPDATE public.tenants SET status='ACTIVE', is_active=true, updated_at=NOW() WHERE id=$1`, [tenantId]
    );
    await publicPool.query(
      `UPDATE public.provision_log SET status='COMPLETED' WHERE tenant_id=$1 AND action='CREATE' AND status='STARTED'`, [tenantId]
    );

    console.log(`[provision] Tenant "${input.slug}" activo ✓`);
    const row = (await publicPool.query(
      `SELECT id,slug,schema_name,plan,status,is_active,trial_ends_at,created_at FROM public.tenants WHERE id=$1`, [tenantId]
    )).rows[0];

    return { id: row.id, slug: row.slug, schemaName: row.schema_name, plan: row.plan, status: row.status, isActive: row.is_active, trialEndsAt: row.trial_ends_at, createdAt: row.created_at };

  } catch (err: any) {
    console.error(`[provision] ERROR:`, err.message);
    if (schemaCreated && schemaName) {
      try { await publicPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); } catch (_) {}
    }
    if (tenantId) {
      try {
        await publicPool.query(`UPDATE public.tenants SET status='FAILED' WHERE id=$1`, [tenantId]);
        await publicPool.query(`UPDATE public.provision_log SET status='FAILED', error_message=$1 WHERE tenant_id=$2 AND action='CREATE'`, [err.message, tenantId]);
      } catch (_) {}
    }
    throw err;
  }
}

export async function suspendTenant(tenantId: number, reason: string, actorId?: number) {
  await publicPool.query(
    `UPDATE public.tenants SET is_active=false,status='SUSPENDED',suspended_at=NOW(),suspend_reason=$1,updated_at=NOW() WHERE id=$2`,
    [reason, tenantId]
  );
  await publicPool.query(
    `INSERT INTO public.provision_log (tenant_id,action,actor_id,status,metadata) VALUES ($1,'SUSPEND',$2,'COMPLETED',$3)`,
    [tenantId, actorId || null, JSON.stringify({ reason })]
  );
}

export async function reactivateTenant(tenantId: number, actorId?: number) {
  await publicPool.query(
    `UPDATE public.tenants SET is_active=true,status='ACTIVE',suspended_at=NULL,suspend_reason=NULL,updated_at=NOW() WHERE id=$1`, [tenantId]
  );
  await publicPool.query(
    `INSERT INTO public.provision_log (tenant_id,action,actor_id,status) VALUES ($1,'REACTIVATE',$2,'COMPLETED')`,
    [tenantId, actorId || null]
  );
}

export async function changeTenantPlan(tenantId: number, newPlan: string, actorId?: number) {
  const { rows } = await publicPool.query("SELECT plan FROM public.tenants WHERE id=$1", [tenantId]);
  const oldPlan = rows[0].plan;
  await publicPool.query("UPDATE public.tenants SET plan=$1,updated_at=NOW() WHERE id=$2", [newPlan, tenantId]);
  await activatePlanModules(tenantId, newPlan);
  await publicPool.query(
    `INSERT INTO public.provision_log (tenant_id,action,actor_id,status,metadata) VALUES ($1,'PLAN_CHANGE',$2,'COMPLETED',$3)`,
    [tenantId, actorId || null, JSON.stringify({ oldPlan, newPlan })]
  );
}

export async function activateAddon(tenantId: number, moduleKey: string, unitCount?: number) {
  const config = ADDON_PRICES[moduleKey];
  if (!config) throw new Error(`Módulo desconocido: ${moduleKey}`);
  await publicPool.query(
    `INSERT INTO public.tenant_modules (tenant_id,module_key,is_active,price,billing_type,unit_count) VALUES ($1,$2,true,$3,$4,$5)
     ON CONFLICT (tenant_id,module_key) DO UPDATE SET is_active=true,activated_at=NOW(),unit_count=$5`,
    [tenantId, moduleKey, config.price, config.billingType, unitCount || 0]
  );
}

export async function runTenantLifecycleCheck() {
  try {
    const { rows } = await publicPool.query(`SELECT id,plan,status,trial_ends_at,business_name FROM public.tenants WHERE is_active=true`);
    for (const t of rows) {
      if (t.plan === "TRIAL" && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()) {
        await suspendTenant(t.id, "TRIAL_EXPIRED");
        console.log(`[lifecycle] Trial vencido: ${t.business_name}`);
      }
    }
  } catch (err: any) { console.error("[lifecycle]", err.message); }
}

async function activatePlanModules(tenantId: number, plan: string) {
  for (const moduleKey of (PLAN_MODULES[plan] || [])) {
    await publicPool.query(
      `INSERT INTO public.tenant_modules (tenant_id,module_key,is_active,price,billing_type) VALUES ($1,$2,true,0,'FIXED')
       ON CONFLICT (tenant_id,module_key) DO UPDATE SET is_active=true`,
      [tenantId, moduleKey]
    );
  }
}

async function createAdminUser(schemaName: string, data: { email: string; password: string; displayName: string }) {
  const hash = await bcrypt.hash(data.password, 10);
  const username = data.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  await publicPool.query(
    `INSERT INTO "${schemaName}".users (username,password,display_name,role,active,email,has_pin) VALUES ($1,$2,$3,'MANAGER',true,$4,false) ON CONFLICT DO NOTHING`,
    [username, hash, data.displayName, data.email]
  );
}

async function seedTenant(schemaName: string, businessName: string) {
  await publicPool.query(`INSERT INTO "${schemaName}".business_config (business_name,legal_note) VALUES ($1,'Gracias por su preferencia') ON CONFLICT DO NOTHING`, [businessName]);
  for (const [name, code] of [["Efectivo","CASH"],["Tarjeta","CARD"],["SINPE Móvil","SINPE"]]) {
    await publicPool.query(`INSERT INTO "${schemaName}".payment_methods (name,code,active) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`, [name, code]);
  }
  for (const [code, name, color] of [["TOP-COMIDAS","Comidas","emerald"],["TOP-BEBIDAS","Bebidas","blue"],["TOP-POSTRES","Postres","rose"],["TOP-ALCOHOL","Alcohol","amber"]]) {
    await publicPool.query(`INSERT INTO "${schemaName}".categories (code,name,active,sort_order,color) VALUES ($1,$2,true,0,$3) ON CONFLICT DO NOTHING`, [code, name, color]);
  }
  await publicPool.query(`INSERT INTO "${schemaName}".hr_settings (work_start_time,work_end_time,late_tolerance_minutes,overtime_threshold_hours) VALUES ('08:00','22:00',10,8) ON CONFLICT DO NOTHING`);
  const perms = ["MODULE_TABLES_VIEW","MODULE_POS_VIEW","MODULE_KDS_VIEW","MODULE_DASHBOARD_VIEW","MODULE_ADMIN_VIEW","MODULE_HR_VIEW","MODULE_INV_VIEW","MODULE_PRODUCTS_VIEW","SHORTAGES_VIEW","POS_PAY","POS_SPLIT","POS_PRINT","POS_EMAIL_TICKET","POS_VOID","POS_VOID_ORDER","POS_REOPEN","POS_VIEW_CASH_REPORT","CASH_CLOSE","POS_EDIT_CUSTOMER_PREPAY","POS_EDIT_CUSTOMER_POSTPAY","ADMIN"];
  for (const key of perms) {
    await publicPool.query(`INSERT INTO "${schemaName}".permissions (key,description) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [key]);
    await publicPool.query(`INSERT INTO "${schemaName}".role_permissions (role,permission_key,granted) VALUES ('MANAGER',$1,true) ON CONFLICT DO NOTHING`, [key]);
  }
}

async function runMigrations(schemaName: string) {
  const source = process.env.TENANT_SCHEMA || "public";
  const tables = ["users","tables","categories","products","payment_methods","modifier_groups","modifier_options","item_modifier_groups","orders","order_items","order_item_modifiers","order_item_taxes","order_item_discounts","order_subaccounts","kitchen_tickets","kitchen_ticket_items","qr_submissions","qr_rate_limits","portion_reservations","payments","cash_sessions","split_accounts","split_items","sales_ledger_items","voided_items","audit_events","discounts","order_discounts","tax_categories","product_tax_categories","business_config","printers","permissions","role_permissions","hr_settings","hr_weekly_schedules","hr_schedule_days","hr_time_punches","service_charge_ledger","service_charge_payouts","hr_extra_types","hr_payroll_extras","inv_items","inv_uom_conversions","inv_suppliers","inv_supplier_items","inv_purchase_orders","inv_purchase_order_lines","inv_po_receipts","inv_po_receipt_lines","inv_physical_counts","inv_physical_count_lines","inv_recipes","inv_recipe_lines","inv_order_item_consumptions","inv_movements","inv_shortages","inv_shortage_events","inv_audit_alerts","reservations","reservation_duration_config","reservation_settings","qbo_config","qbo_category_mapping","qbo_sync_log","qbo_export_jobs"];
  for (const table of tables) {
    try {
      await publicPool.query(`CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}" (LIKE "${source}"."${table}" INCLUDING ALL)`);
    } catch (err: any) {
      if (!err.message.includes("does not exist")) console.warn(`[migration] ${table}: ${err.message}`);
    }
  }
}
```

---

### ARCHIVO 5: `server/provision/provision-routes.ts`

```typescript
/**
 * server/provision/provision-routes.ts
 * API REST del panel superadmin. Prefijo: /api/superadmin/*
 */

import type { Express, Request, Response } from "express";
import { Pool } from "pg";
import { createTenant, suspendTenant, reactivateTenant, changeTenantPlan, activateAddon, validateSlug } from "./provision-service";
import { ADDON_PRICES, PLAN_PRICES, PLAN_MODULES } from "@shared/schema-public";

const publicPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

async function requireSuperadmin(req: Request, res: Response, next: Function) {
  const token = req.headers["x-superadmin-token"] as string;
  if (!token) return res.status(401).json({ message: "Token requerido" });
  if (process.env.SUPERADMIN_TOKEN && token === process.env.SUPERADMIN_TOKEN) {
    (req as any).superadminId = 0;
    return next();
  }
  return res.status(401).json({ message: "Token inválido" });
}

export function registerProvisionRoutes(app: Express) {

  app.get("/api/superadmin/tenants", requireSuperadmin, async (_req, res) => {
    try {
      const r = await publicPool.query(`SELECT t.*, COUNT(tm.id) FILTER (WHERE tm.is_active) AS active_modules FROM public.tenants t LEFT JOIN public.tenant_modules tm ON tm.tenant_id=t.id GROUP BY t.id ORDER BY t.created_at DESC`);
      res.json(r.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/superadmin/tenants/:id", requireSuperadmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [tenant, modules, logs] = await Promise.all([
        publicPool.query("SELECT * FROM public.tenants WHERE id=$1", [id]),
        publicPool.query("SELECT * FROM public.tenant_modules WHERE tenant_id=$1 ORDER BY module_key", [id]),
        publicPool.query("SELECT * FROM public.provision_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20", [id]),
      ]);
      if (!tenant.rows.length) return res.status(404).json({ message: "No encontrado" });
      res.json({ tenant: tenant.rows[0], modules: modules.rows, logs: logs.rows });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/superadmin/tenants", requireSuperadmin, async (req, res) => {
    try {
      const { slug, businessName, plan, billingEmail, adminEmail, adminPassword, adminDisplayName } = req.body;
      if (!slug || !businessName || !plan || !billingEmail || !adminEmail) return res.status(400).json({ message: "Faltan campos requeridos" });
      const err = validateSlug(slug);
      if (err) return res.status(400).json({ message: err });
      const result = await createTenant({ slug, businessName, plan, billingEmail, adminEmail, adminPassword: adminPassword || "TempPass123!", adminDisplayName: adminDisplayName || businessName, actorId: (req as any).superadminId });
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ message: err.message }); }
  });

  app.post("/api/superadmin/tenants/:id/suspend", requireSuperadmin, async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ message: "Razón requerida" });
      await suspendTenant(parseInt(req.params.id), reason, (req as any).superadminId);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/superadmin/tenants/:id/reactivate", requireSuperadmin, async (req, res) => {
    try {
      await reactivateTenant(parseInt(req.params.id), (req as any).superadminId);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/superadmin/tenants/:id/plan", requireSuperadmin, async (req, res) => {
    try {
      const { plan } = req.body;
      if (!["BASIC","PRO","ENTERPRISE"].includes(plan)) return res.status(400).json({ message: "Plan inválido" });
      await changeTenantPlan(parseInt(req.params.id), plan, (req as any).superadminId);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/superadmin/tenants/:id/modules", requireSuperadmin, async (req, res) => {
    try {
      const { moduleKey, unitCount } = req.body;
      if (!moduleKey) return res.status(400).json({ message: "moduleKey requerido" });
      await activateAddon(parseInt(req.params.id), moduleKey, unitCount);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/superadmin/tenants/:id/modules/:moduleKey", requireSuperadmin, async (req, res) => {
    try {
      await publicPool.query(`UPDATE public.tenant_modules SET is_active=false,deactivated_at=NOW() WHERE tenant_id=$1 AND module_key=$2`, [parseInt(req.params.id), req.params.moduleKey]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/superadmin/pricing", requireSuperadmin, (_req, res) => {
    res.json({ plans: PLAN_PRICES, addons: ADDON_PRICES, planModules: PLAN_MODULES });
  });

  app.get("/api/superadmin/metrics", requireSuperadmin, async (_req, res) => {
    try {
      const r = await publicPool.query(`SELECT COUNT(*) FILTER (WHERE is_active) AS active_tenants, COUNT(*) FILTER (WHERE plan='TRIAL') AS trial_tenants, COUNT(*) FILTER (WHERE plan='BASIC' AND is_active) AS basic_tenants, COUNT(*) FILTER (WHERE plan='PRO' AND is_active) AS pro_tenants, COUNT(*) FILTER (WHERE plan='ENTERPRISE' AND is_active) AS enterprise_tenants, COUNT(*) FILTER (WHERE status='SUSPENDED') AS suspended_tenants FROM public.tenants`);
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/superadmin/setup", requireSuperadmin, async (_req, res) => {
    try { await ensurePublicTables(); res.json({ ok: true }); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  console.log("[provision] Rutas superadmin registradas en /api/superadmin/*");
}

export async function ensurePublicTables() {
  await publicPool.query(`
    CREATE TABLE IF NOT EXISTS public.tenants (
      id SERIAL PRIMARY KEY, slug VARCHAR(50) NOT NULL UNIQUE,
      business_name VARCHAR(200) NOT NULL, schema_name VARCHAR(63) NOT NULL UNIQUE,
      plan VARCHAR(20) NOT NULL DEFAULT 'TRIAL', status VARCHAR(30) NOT NULL DEFAULT 'PROVISIONING',
      is_active BOOLEAN NOT NULL DEFAULT false, trial_ends_at TIMESTAMP,
      suspended_at TIMESTAMP, suspend_reason TEXT, billing_email TEXT,
      stripe_customer_id VARCHAR(100), onboarding_file_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.tenant_modules (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES public.tenants(id),
      module_key VARCHAR(50) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
      activated_at TIMESTAMP NOT NULL DEFAULT NOW(), deactivated_at TIMESTAMP,
      price INTEGER NOT NULL DEFAULT 0, billing_type VARCHAR(20) NOT NULL DEFAULT 'FIXED',
      unit_count INTEGER DEFAULT 0, notes TEXT, UNIQUE(tenant_id, module_key)
    );
    CREATE TABLE IF NOT EXISTS public.superadmin_users (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'SUPPORT', is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.provision_log (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES public.tenants(id),
      action VARCHAR(50) NOT NULL, actor_id INTEGER, status VARCHAR(20) NOT NULL,
      error_message TEXT, metadata JSONB, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.billing_events (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES public.tenants(id),
      event_type VARCHAR(50) NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL, billing_date TIMESTAMP NOT NULL DEFAULT NOW(),
      stripe_invoice_id VARCHAR(100), status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("[provision] Tablas public verificadas/creadas");
}
```

---

### ARCHIVO 6: `server/dispatch-routes.ts`

```typescript
/**
 * server/dispatch-routes.ts
 *
 * Modelo 3: Despacho (Food Court / QR Directo)
 * El cliente ordena desde QR → va directo a cocina → notificación cuando está lista.
 * QR de despacho: /qr/MESA-01?mode=dispatch
 */

import type { Express, Request, Response } from "express";
import { WebSocket } from "ws";
import { eq, and, inArray } from "drizzle-orm";
import { db as globalDb } from "./db";
import * as schema from "@shared/schema";

const dispatchSessions = new Map<number, WebSocket>();

export function registerDispatchSession(orderId: number, ws: WebSocket) {
  dispatchSessions.set(orderId, ws);
  ws.on("close", () => dispatchSessions.delete(orderId));
  console.log(`[dispatch] Sesión registrada para orden ${orderId}`);
}

export function notifyDispatchReady(orderId: number, payload: {
  orderId: number; customerName: string; tableCode: string;
  items: { name: string; qty: number }[]; readyAt: string;
}) {
  const ws = dispatchSessions.get(orderId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "dispatch_ready", payload }));
    dispatchSessions.delete(orderId);
    console.log(`[dispatch] ✓ Notificación enviada: orden ${orderId}`);
    return true;
  }
  return false;
}

export function registerDispatchRoutes(app: Express, broadcast: Function) {

  app.post("/api/dispatch/:tableCode/submit", async (req: Request, res: Response) => {
    try {
      const { tableCode } = req.params;
      const { items, customerName } = req.body;
      const db = (req as any).db || globalDb;

      if (!items?.length) return res.status(400).json({ message: "Items requeridos" });
      if (!customerName?.trim()) return res.status(400).json({ message: "Nombre requerido" });

      const [table] = await db.select().from(schema.tables).where(eq(schema.tables.tableCode, tableCode));
      if (!table) return res.status(404).json({ message: "Mesa no encontrada" });

      const openOrders = await db.select().from(schema.orders).where(
        and(eq(schema.orders.tableId, table.id), inArray(schema.orders.status, ["OPEN","IN_KITCHEN","READY","PREPARING"]))
      );

      let order = openOrders[0];
      if (!order) {
        const businessDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
        [order] = await db.insert(schema.orders).values({ tableId: table.id, status: "OPEN", businessDate, responsibleWaiterId: null }).returning();
      }

      const existingItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const roundNumber = existingItems.reduce((max: number, i: any) => Math.max(max, i.roundNumber || 0), 0) + 1;

      const insertedItems = [];
      for (const item of items) {
        const [orderItem] = await db.insert(schema.orderItems).values({
          orderId: order.id, productId: item.productId,
          productNameSnapshot: item.productName || item.name,
          productPriceSnapshot: String(item.unitPrice || item.price || "0"),
          qty: item.qty || 1, status: "NEW", roundNumber,
          customerNameSnapshot: customerName.trim(), notes: item.notes || null,
        }).returning();
        insertedItems.push(orderItem);
      }

      await db.update(schema.orders).set({ status: "IN_KITCHEN" }).where(eq(schema.orders.id, order.id));

      const [ticket] = await db.insert(schema.kitchenTickets).values({
        orderId: order.id, tableNameSnapshot: table.tableName, status: "PENDING", destination: "cocina",
      }).returning();

      for (const orderItem of insertedItems) {
        await db.insert(schema.kitchenTicketItems).values({
          ticketId: ticket.id, orderItemId: orderItem.id,
          productNameSnapshot: orderItem.productNameSnapshot, qty: orderItem.qty,
          status: "NEW", notes: orderItem.notes, customerNameSnapshot: orderItem.customerNameSnapshot,
        });
      }

      broadcast("kitchen_ticket_created", { ticketId: ticket.id, orderId: order.id, tableNameSnapshot: table.tableName, destination: "cocina" });
      broadcast("order_updated", { orderId: order.id, status: "IN_KITCHEN" });
      broadcast("qr_submission_created", { tableId: table.id, tableCode, customerName: customerName.trim(), orderId: order.id, mode: "DISPATCH" });

      res.json({ ok: true, orderId: order.id, tableCode, customerName: customerName.trim(), message: "Orden enviada a cocina. Mantén esta pantalla abierta." });

    } catch (err: any) {
      console.error("[dispatch] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch/order/:orderId/status", async (req: Request, res: Response) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const db = (req as any).db || globalDb;
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
      if (!order) return res.status(404).json({ message: "Orden no encontrada" });
      res.json({ orderId, status: order.status, isReady: order.status === "READY", hasActiveSession: dispatchSessions.has(orderId) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  console.log("[dispatch] Rutas de despacho registradas");
}
```

---

## PASO 3 — CAMBIOS EN ARCHIVOS EXISTENTES

### En `server/index.ts`

**Agregar** después de `import { retryPendingSync } from "./quickbooks";`:

```typescript
import { runTenantLifecycleCheck } from "./provision/provision-service";
import { ensurePublicTables } from "./provision/provision-routes";
```

**Agregar** ANTES de `await registerRoutes(httpServer, app);`:

```typescript
await ensurePublicTables();
```

**Agregar** dentro del callback `httpServer.listen(...)`, después de `startHrBackgroundJobs();`:

```typescript
setInterval(() => {
  runTenantLifecycleCheck().catch(err => console.error("[lifecycle] Error:", err.message));
}, 60 * 60 * 1000);
```

---

### En `server/routes.ts`

**Cambio 1** — Agregar después de los imports existentes (después de la línea `import * as qbo from "./quickbooks";`):

```typescript
import { tenantMiddleware } from "./middleware/tenant";
import { registerDispatchRoutes, registerDispatchSession, notifyDispatchReady } from "./dispatch-routes";
import { registerProvisionRoutes } from "./provision/provision-routes";
```

**Cambio 2** — Después de la línea `app.use(sessionMiddleware);` (línea ~418), agregar:

```typescript
app.use(tenantMiddleware);
```

**Cambio 3** — Corregir el bug en la línea `registerInventoryRoutes(app, null);`:

```typescript
// CAMBIAR:
registerInventoryRoutes(app, null);
// POR:
registerInventoryRoutes(app, broadcast);
```

**Cambio 4** — Dentro del handler `ws.on("message", (raw) => { ... })`, después del bloque `if (msg.type === "print_bridge_register")`, agregar:

```typescript
if (msg.type === "dispatch_register" && msg.orderId) {
  registerDispatchSession(Number(msg.orderId), ws);
}
```

**Cambio 5** — Buscar la ruta `PATCH /api/kds/tickets/:id` que marca el ticket como completado. Dentro de esa ruta, después de que se actualiza el estado del ticket y antes del `res.json(...)`, agregar:

```typescript
// Notificar al cliente en modo dispatch si tiene sesión activa
if (ticket?.orderId) {
  notifyDispatchReady(ticket.orderId, {
    orderId: ticket.orderId,
    customerName: ticket.tableNameSnapshot || "Cliente",
    tableCode: ticket.tableNameSnapshot || "",
    items: [],
    readyAt: new Date().toISOString(),
  });
}
```

**Cambio 6** — Antes de `return httpServer;` al final de `registerRoutes()`, agregar:

```typescript
registerDispatchRoutes(app, broadcast);
registerProvisionRoutes(app);
```

---

## PASO 4 — VERIFICACIÓN FINAL

Después de aplicar todos los cambios, reiniciar el servidor y confirmar en los logs:

```
[provision] Tablas public verificadas/creadas
[provision] Rutas superadmin registradas en /api/superadmin/*
[dispatch] Rutas de despacho registradas
[db-tenant] Schema "public" conectado
```

Y que el sistema existente funciona igual: login, mesas, POS, KDS, sin errores.

**Test rápido:**
```
GET /api/superadmin/metrics
Header: X-Superadmin-Token: rmscore-superadmin-2026
```
Debe responder: `{ "active_tenants": "0", "trial_tenants": "0", ... }`
