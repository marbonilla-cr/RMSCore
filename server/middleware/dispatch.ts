/**
 * server/middleware/dispatch.ts
 *
 * Fuente única de verdad para verificar si el modo despacho está activo.
 * Usar estas funciones en lugar de checks inline de operationModeDispatch
 * en routes.ts y qr-subaccount-routes.ts.
 */

import type { Request, Response, NextFunction } from "express";
import { businessConfig } from "@shared/schema";

/**
 * Helper sync: evalúa un objeto config ya cargado.
 * Usar cuando el handler ya hizo el SELECT de businessConfig por otra razón.
 */
export function isConfigDispatchEnabled(config: any): boolean {
  return config?.operationModeDispatch === true;
}

/**
 * Helper async: lee businessConfig del tenant y evalúa operationModeDispatch.
 * Siempre resuelve (nunca rechaza): retorna false ante cualquier error de DB.
 * @param tenantDb  Instancia de drizzle del tenant (req.db)
 */
export async function isDispatchEnabled(tenantDb: any): Promise<boolean> {
  try {
    const [config] = await tenantDb.select().from(businessConfig).limit(1);
    return isConfigDispatchEnabled(config);
  } catch {
    return false;
  }
}

/**
 * Express middleware: retorna 404 si despacho no está activo.
 * Para uso en rutas dispatch-exclusivas (futuras).
 * Delega el manejo de errores en isDispatchEnabled (ya atrapa internamente).
 */
export async function requireDispatchEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
  const enabled = await isDispatchEnabled((req as any).db);
  if (!enabled) {
    res.status(404).json({ message: "El servicio de despacho no está disponible en este restaurante." });
    return;
  }
  next();
}
