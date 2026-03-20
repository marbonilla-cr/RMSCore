/**
 * Login central (APK / login.rmscore.app): busca email en todos los tenants activos
 * y abre sesión en el schema correcto.
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "./db";
import * as storage from "./storage";
import { getTenantDb } from "./db-tenant";

const centralLoginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

const SAFE_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function listActiveTenantSchemas(): Promise<
  { id: number; slug: string; schema_name: string }[]
> {
  const { rows } = await pool.query(
    `SELECT id, slug, schema_name FROM public.tenants
     WHERE is_active = true AND status = 'ACTIVE'
     ORDER BY id`
  );
  return rows as { id: number; slug: string; schema_name: string }[];
}

/** Coincidencias de email (activos) en todos los tenants — debe haber como máximo una para login central. */
export async function findUsersWithEmailGlobal(
  emailNormalized: string
): Promise<{ tenantId: number; slug: string; schemaName: string; userId: number }[]> {
  const tenants = await listActiveTenantSchemas();
  const matches: { tenantId: number; slug: string; schemaName: string; userId: number }[] = [];
  for (const t of tenants) {
    const schema = t.schema_name;
    if (!SAFE_SCHEMA.test(schema)) {
      console.warn("[auth-central] schema omitido (nombre no seguro):", schema);
      continue;
    }
    const { rows } = await pool.query(
      `SELECT id FROM "${schema}".users
       WHERE active = true AND email IS NOT NULL AND LOWER(TRIM(email)) = $1`,
      [emailNormalized]
    );
    for (const row of rows as { id: number }[]) {
      matches.push({
        tenantId: t.id,
        slug: t.slug,
        schemaName: schema,
        userId: row.id,
      });
    }
  }
  return matches;
}

/**
 * No permitir el mismo email en otro tenant (crear/editar empleado).
 */
export async function assertEmployeeEmailUniqueAcrossTenants(
  email: string | null | undefined,
  currentSchema: string,
  excludeUserId?: number | null
): Promise<void> {
  const trimmed = email?.trim();
  if (!trimmed) return;
  const norm = trimmed.toLowerCase();
  const tenants = await listActiveTenantSchemas();

  for (const t of tenants) {
    const schema = t.schema_name;
    if (!SAFE_SCHEMA.test(schema)) continue;

    let q: { rows: { id: number }[] };
    if (schema === currentSchema && excludeUserId != null) {
      q = await pool.query(
        `SELECT id FROM "${schema}".users
         WHERE email IS NOT NULL AND LOWER(TRIM(email)) = $1 AND id <> $2`,
        [norm, excludeUserId]
      );
    } else {
      q = await pool.query(
        `SELECT id FROM "${schema}".users
         WHERE email IS NOT NULL AND LOWER(TRIM(email)) = $1`,
        [norm]
      );
    }
    if (q.rows.length > 0) {
      throw new Error("Este email ya está registrado en otro restaurante o en otro usuario");
    }
  }
}

export async function handleCentralLogin(
  req: Request,
  res: Response,
  opts: { onSuccessClearRateLimit?: () => void }
): Promise<void> {
  try {
    const { email, password } = centralLoginSchema.parse(req.body);
    const norm = email.trim().toLowerCase();

    const matches = await findUsersWithEmailGlobal(norm);
    if (matches.length === 0) {
      res.status(401).json({ message: "Credenciales incorrectas" });
      return;
    }
    if (matches.length > 1) {
      console.error("[auth-central] email duplicado entre tenants:", norm);
      res.status(401).json({ message: "Credenciales incorrectas" });
      return;
    }

    const m = matches[0];
    const tdb = getTenantDb(m.schemaName);
    const user = await storage.getUser(m.userId, tdb);
    if (!user || !user.active) {
      res.status(401).json({ message: "Credenciales incorrectas" });
      return;
    }

    const valid = await storage.verifyPassword(password, user.password);
    if (!valid) {
      res.status(401).json({ message: "Credenciales incorrectas" });
      return;
    }

    opts.onSuccessClearRateLimit?.();
    req.session.userId = user.id;
    (req.session as any).tenantSchema = m.schemaName;
    (req.session as any).tenantId = m.tenantId;

    await storage.createAuditEvent(
      {
        actorType: "USER",
        actorUserId: user.id,
        action: "LOGIN_CENTRAL",
        entityType: "USER",
        entityId: user.id,
        metadata: { slug: m.slug },
      },
      tdb
    );

    const { password: _, pin: _p, ...safeUser } = user;
    req.session.save((err) => {
      if (err) {
        console.error("[auth-central] session save:", err.message);
        return res.status(500).json({ message: "Error de sesión" });
      }
      res.json({
        slug: m.slug,
        tenantUrl: `https://${m.slug}.rmscore.app`,
        user: {
          username: safeUser.username,
          displayName: safeUser.displayName,
          role: safeUser.role,
        },
        sessionToken: req.sessionID,
      });
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error("[auth-central]", err.message);
    res.status(500).json({ message: err.message || "Error interno" });
  }
}
