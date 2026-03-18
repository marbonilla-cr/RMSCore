/**
 * server/middleware/dispatch.ts
 *
 * Fuente única de verdad para verificar si el modo despacho está activo.
 * Usar estas funciones en lugar de checks inline de operationModeDispatch
 * en routes.ts y qr-subaccount-routes.ts.
 */

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
 */
export function requireDispatchEnabled(req: any, res: any, next: any): void {
  isDispatchEnabled(req.db)
    .then(enabled => {
      if (!enabled) {
        return res.status(404).json({
          message: "El servicio de despacho no está disponible en este restaurante.",
        });
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ message: "Error verificando configuración de despacho" });
    });
}
