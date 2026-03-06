/**
 * server/provision/provision-routes.ts
 * API REST del panel superadmin. Prefijo: /api/superadmin/*
 */

import type { Express, Request, Response } from "express";
import { Pool } from "pg";
import { createTenant, suspendTenant, reactivateTenant, changeTenantPlan, activateAddon, validateSlug, reprovisionTenant, type ReprovisionInput } from "./provision-service";
import { getMigrationStatus } from "./migrate-tenants";
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
      const { slug, businessName, plan, billingEmail, adminEmail, adminPassword, adminDisplayName, orderDailyStart, orderGlobalStart, invoiceStart } = req.body;
      if (!slug || !businessName || !plan || !billingEmail || !adminEmail) return res.status(400).json({ message: "Faltan campos requeridos" });
      const err = validateSlug(slug);
      if (err) return res.status(400).json({ message: err });
      const result = await createTenant({
        slug, businessName, plan, billingEmail,
        adminEmail, adminPassword: adminPassword || "TempPass123!",
        adminDisplayName: adminDisplayName || businessName,
        actorId: (req as any).superadminId,
        orderDailyStart: orderDailyStart ? parseInt(orderDailyStart) : undefined,
        orderGlobalStart: orderGlobalStart ? parseInt(orderGlobalStart) : undefined,
        invoiceStart: invoiceStart ? parseInt(invoiceStart) : undefined,
      });
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

  app.post("/api/superadmin/tenants/:id/reprovision", requireSuperadmin, async (req, res) => {
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
        orderDailyStart: orderDailyStart ? parseInt(orderDailyStart) : undefined,
        orderGlobalStart: orderGlobalStart ? parseInt(orderGlobalStart) : undefined,
        invoiceStart: invoiceStart ? parseInt(invoiceStart) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/superadmin/migration-status", requireSuperadmin, async (_req, res) => {
    try {
      const status = await getMigrationStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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
