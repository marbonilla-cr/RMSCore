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
