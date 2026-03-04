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
