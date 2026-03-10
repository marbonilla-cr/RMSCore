import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PLAN_MODULES, ADDON_PRICES } from "@shared/schema-public";
import { propagateMigrations } from "./migrate-tenants";
import { seedTenantSchema } from "../storage";
import { sendEmail } from "../services/email-service";

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
  orderDailyStart?: number;
  orderGlobalStart?: number;
  invoiceStart?: number;
  trialBasePlan?: string;
}

export interface ReprovisionInput {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
  actorId?: number;
  orderDailyStart?: number;
  orderGlobalStart?: number;
  invoiceStart?: number;
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
      `INSERT INTO public.tenants (slug, business_name, schema_name, plan, status, is_active, trial_ends_at, billing_email, trial_base_plan)
       VALUES ($1,$2,$3,$4,'PROVISIONING',false,$5,$6,$7) RETURNING id`,
      [input.slug, input.businessName, schemaName, input.plan, trialEndsAt, input.billingEmail, input.plan === "TRIAL" ? (input.trialBasePlan || "BASIC") : null]
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
    await seedTenant(schemaName, input.businessName, {
      orderDailyStart: input.orderDailyStart,
      orderGlobalStart: input.orderGlobalStart,
      invoiceStart: input.invoiceStart,
    });
    const adminPin = generateRandomPin();
    const adminUsername = await createAdminUser(schemaName, { email: input.adminEmail, password: input.adminPassword, displayName: input.adminDisplayName, pin: adminPin });
    const modulePlan = input.plan === "TRIAL" ? (input.trialBasePlan || "BASIC") : input.plan;
    await activatePlanModules(tenantId, modulePlan);

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

    sendWelcomeEmail(input.adminEmail, input.businessName, input.slug, adminUsername, input.adminPassword || "TempPass123!", adminPin).catch(e => console.error("[provision] welcome email error:", e.message));

    return { id: row.id, slug: row.slug, schemaName: row.schema_name, plan: row.plan, status: row.status, isActive: row.is_active, trialEndsAt: row.trial_ends_at, createdAt: row.created_at, credentials: { username: adminUsername, password: input.adminPassword || "TempPass123!", pin: adminPin } };

  } catch (err: any) {
    console.error(`[provision] ERROR:`, err.message);
    if (schemaCreated && schemaName) {
      try {
        await publicPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await publicPool.query(`DELETE FROM public.schema_migrations WHERE schema_name = $1`, [schemaName]);
      } catch (_) {}
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

export async function reprovisionTenant(tenantId: number, input: ReprovisionInput) {
  const { rows } = await publicPool.query(
    `SELECT id, slug, schema_name, plan, status, business_name
     FROM public.tenants WHERE id = $1`,
    [tenantId]
  );
  if (rows.length === 0) throw new Error(`Tenant ${tenantId} no encontrado`);

  const tenant = rows[0];
  if (tenant.status !== "FAILED" && tenant.status !== "ACTIVE") {
    throw new Error(
      `Solo se puede re-provisionar tenants FAILED o ACTIVE. Status actual: ${tenant.status}`
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
    await publicPool.query(
      `DELETE FROM public.schema_migrations WHERE schema_name = $1`,
      [schemaName]
    );
    console.log(`[reprovision] Schema "${schemaName}" eliminado (migrations reset)`);

    await publicPool.query(
      `UPDATE public.tenants SET status='PROVISIONING', is_active=false,
       updated_at=NOW() WHERE id=$1`,
      [tenantId]
    );

    await publicPool.query(`CREATE SCHEMA "${schemaName}"`);
    console.log(`[reprovision] Schema "${schemaName}" re-creado`);

    await runMigrations(schemaName);
    await seedTenant(schemaName, tenant.business_name, {
      orderDailyStart: input.orderDailyStart,
      orderGlobalStart: input.orderGlobalStart,
      invoiceStart: input.invoiceStart,
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

function generateRandomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function createAdminUser(schemaName: string, data: { email: string; password: string; displayName: string; pin?: string }): Promise<string> {
  const hash = await bcrypt.hash(data.password || "TempPass123!", 10);
  const username = data.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const pinHash = data.pin ? await bcrypt.hash(data.pin, 10) : null;
  await publicPool.query(
    `INSERT INTO "${schemaName}".users (username,password,display_name,role,active,email,pin)
     VALUES ($1,$2,$3,'MANAGER',true,$4,$5)
     ON CONFLICT (username) DO UPDATE SET password=$2, display_name=$3, email=$4, pin=$5, active=true`,
    [username, hash, data.displayName, data.email, pinHash]
  );
  return username;
}

export async function sendTenantPasswordReset(tenantId: number, email: string, reqHost: string, reqProto: string) {
  const { rows: tenantRows } = await publicPool.query(
    `SELECT id, slug, schema_name, business_name FROM public.tenants WHERE id = $1`,
    [tenantId]
  );
  if (tenantRows.length === 0) throw new Error(`Tenant ${tenantId} no encontrado`);
  const tenant = tenantRows[0];
  const schemaName = tenant.schema_name;

  const { rows: userRows } = await publicPool.query(
    `SELECT id, email, username, display_name FROM "${schemaName}".users WHERE role = 'MANAGER' AND active = true ORDER BY id ASC LIMIT 1`
  );
  if (userRows.length === 0) throw new Error("No se encontró un usuario MANAGER activo en este tenant");
  const adminUser = userRows[0];

  if (adminUser.email?.toLowerCase() !== email.toLowerCase()) {
    await publicPool.query(
      `UPDATE "${schemaName}".users SET email = $1 WHERE id = $2`,
      [email, adminUser.id]
    );
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await publicPool.query(
    `UPDATE "${schemaName}".users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
    [resetToken, expires, adminUser.id]
  );

  const resetUrl = `${reqProto}://${reqHost}/reset-password?token=${resetToken}`;
  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 4px;">RMSCore</h1>
        <p style="font-size:14px;color:#888;margin:0;">Restablecimiento de contraseña</p>
      </div>
      <div style="background:#f8f6f3;border-radius:10px;padding:24px;margin-bottom:20px;">
        <h2 style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0 0 8px;">Hola ${adminUser.display_name || adminUser.username}</h2>
        <p style="font-size:14px;color:#555;margin:0;">${tenant.business_name}</p>
      </div>
      <p style="font-size:14px;color:#555;line-height:1.6;margin-bottom:20px;">
        El administrador del sistema ha solicitado restablecer tu contraseña. Haz clic en el siguiente botón para crear una nueva:
      </p>
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;">Restablecer contraseña</a>
      </div>
      <div style="background:#fffbeb;border:1px solid #f5e6b8;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="font-size:13px;color:#92400e;margin:0;">Este enlace es válido por 1 hora. Si no reconoces esta solicitud, contacta al soporte.</p>
      </div>
      <p style="font-size:11px;color:#aaa;text-align:center;margin:0;">Este correo fue generado automáticamente por RMSCore.</p>
    </div>`;
  await sendEmail(email, `Restablecimiento de contraseña - ${tenant.business_name}`, html);

  return { sent: true, username: adminUser.username, email };
}

async function sendWelcomeEmail(to: string, businessName: string, slug: string, username: string, password: string, pin: string) {
  const url = `https://${slug}.rmscore.app`;
  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 4px;">RMSCore</h1>
        <p style="font-size:14px;color:#888;margin:0;">Sistema de Gestión para Restaurantes</p>
      </div>
      <div style="background:#f8f6f3;border-radius:10px;padding:24px;margin-bottom:20px;">
        <h2 style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0 0 8px;">¡Tu sistema está listo!</h2>
        <p style="font-size:14px;color:#555;margin:0;">${businessName}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:10px 14px;font-size:13px;color:#888;border-bottom:1px solid #eee;">URL de acceso</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:#1d4ed8;border-bottom:1px solid #eee;"><a href="${url}" style="color:#1d4ed8;">${url}</a></td></tr>
        <tr><td style="padding:10px 14px;font-size:13px;color:#888;border-bottom:1px solid #eee;">Usuario</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1a1a1a;border-bottom:1px solid #eee;font-family:monospace;">${username}</td></tr>
        <tr><td style="padding:10px 14px;font-size:13px;color:#888;border-bottom:1px solid #eee;">Contraseña</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1a1a1a;border-bottom:1px solid #eee;font-family:monospace;">${password}</td></tr>
        <tr><td style="padding:10px 14px;font-size:13px;color:#888;">PIN</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1a1a1a;font-family:monospace;">${pin}</td></tr>
      </table>
      <div style="background:#fffbeb;border:1px solid #f5e6b8;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="font-size:13px;color:#92400e;margin:0;">⚠️ Te recomendamos cambiar tu contraseña y PIN en el primer acceso.</p>
      </div>
      <p style="font-size:11px;color:#aaa;text-align:center;margin:0;">Este correo fue generado automáticamente por RMSCore.</p>
    </div>`;
  await sendEmail(to, `Bienvenido a RMSCore - ${businessName}`, html);
}

async function seedTenant(
  schemaName: string,
  businessName: string,
  sequences?: {
    orderDailyStart?: number;
    orderGlobalStart?: number;
    invoiceStart?: number;
  }
): Promise<void> {
  await seedTenantSchema(publicPool, schemaName, businessName, sequences);
}

async function runMigrations(schemaName: string): Promise<void> {
  await propagateMigrations(schemaName);
}
