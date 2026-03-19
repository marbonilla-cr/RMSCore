import * as crypto from 'crypto';
import { getTenantDb } from '../db-tenant';
import { printers, printBridges } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { pool } from '../db';

/** In-memory WS connections.
 * Keyed by `tenantSchema + bridgeId` so multi-tenant bridges never collide when bridge_id is reused (e.g. seeded `bridge-001`). */
const bridgeConnections = new Map<string, {
  ws: WebSocket;
  bridgeId: string;
  tenantSchema: string;
  connectedAt: Date;
}>();

function connectionKey(tenantSchema: string, bridgeId: string): string {
  return `${tenantSchema}::${bridgeId}`;
}

export function registerBridge(
  bridgeId: string,
  tenantSchema: string,
  ws: WebSocket
): void {
  bridgeConnections.set(connectionKey(tenantSchema, bridgeId), {
    ws, bridgeId, tenantSchema, connectedAt: new Date()
  });
  console.log(`[print] Bridge registrado: ${bridgeId} (${tenantSchema})`);
  getTenantDb(tenantSchema)
    .update(printBridges)
    .set({ lastSeenAt: new Date() })
    .where(eq(printBridges.bridgeId, bridgeId))
    .execute()
    .catch(() => {});
}

export function unregisterBridge(bridgeId: string, tenantSchema: string): void {
  const key = connectionKey(tenantSchema, bridgeId);
  const c = bridgeConnections.get(key);
  if (c) console.log(`[print] Bridge desconectado: ${c.bridgeId}`);
  bridgeConnections.delete(key);
}

export async function validateBridgeToken(
  token: string,
  tenantSchema: string
): Promise<{ valid: boolean; bridgeId?: string }> {
  try {
    const db = getTenantDb(tenantSchema);
    const rows = await db
      .select()
      .from(printBridges)
      .where(and(
        eq(printBridges.token, token),
        eq(printBridges.isActive, true)
      ));
    if (!rows.length) return { valid: false };
    return { valid: true, bridgeId: rows[0].bridgeId };
  } catch {
    return { valid: false };
  }
}

export async function authenticateBridgeByMessage(
  token: string,
  ws: WebSocket
): Promise<boolean> {
  try {
    const { rows: tenants } = await pool.query(
      `SELECT schema_name FROM public.tenants
       WHERE is_active = true ORDER BY id`
    );
    for (const tenant of tenants) {
      const result = await validateBridgeToken(token, tenant.schema_name);
      if (result.valid && result.bridgeId) {
        const bridgeId = result.bridgeId;
        const tenantSchema = tenant.schema_name;
        registerBridge(bridgeId, tenantSchema, ws);
        ws.on('close', () => unregisterBridge(bridgeId, tenantSchema));
        ws.send(JSON.stringify({
          type: 'CONNECTED',
          bridgeId,
          schema: tenant.schema_name,
        }));
        return true;
      }
    }
  } catch (err: any) {
    console.error('[print] Error en authenticateBridgeByMessage:', err.message);
  }
  return false;
}

export async function dispatchPrintJobViaBridge(
  tenantSchema: string,
  printerId: number,
  payload: string,
  jobType: string = 'receipt'
): Promise<{ success: boolean; error?: string }> {
  const db = getTenantDb(tenantSchema);

  const [printer] = await db
    .select()
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.enabled, true)));

  if (!printer)
    return { success: false, error: 'Impresora no encontrada o inactiva' };
  if (!printer.bridgeId)
    return { success: false, error: 'Impresora sin bridge asignado' };

  const [bridge] = await db
    .select()
    .from(printBridges)
    .where(and(
      eq(printBridges.bridgeId, printer.bridgeId),
      eq(printBridges.isActive, true)
    ));

  if (!bridge)
    return { success: false, error: 'Bridge no configurado' };

  const conn = bridgeConnections.get(connectionKey(tenantSchema, printer.bridgeId));
  if (!conn || conn.ws.readyState !== 1)
    return { success: false, error: `Bridge "${bridge.displayName}" no conectado` };

  conn.ws.send(JSON.stringify({
    type: 'PRINT_JOB',
    printerId,
    printerIp: printer.ipAddress,
    printerPort: printer.port ?? 9100,
    paperWidth: printer.paperWidth ?? 80,
    jobType,
    payload,
  }));

  return { success: true };
}

export function isBridgeConnected(tenantSchema: string): boolean {
  for (const conn of Array.from(bridgeConnections.values())) {
    if (conn.tenantSchema === tenantSchema && conn.ws.readyState === 1)
      return true;
  }
  return false;
}

export function getConnectedBridgesForTenant(tenantSchema: string) {
  return Array.from(bridgeConnections.entries())
    .filter(([, c]) => c.tenantSchema === tenantSchema)
    .map(([, c]) => ({
      bridgeId: c.bridgeId,
      connectedAt: c.connectedAt,
    }));
}

/**
 * Ensures a print_bridges row exists for session-based bridge (user-{userId}).
 * Called when a user registers as print bridge via WebSocket with session auth.
 * Returns the bridgeId to use for registerBridge().
 */
export async function ensureUserBridge(
  userId: number,
  tenantSchema: string,
  displayName?: string
): Promise<string> {
  const bridgeId = `user-${userId}`;
  const db = getTenantDb(tenantSchema);
  const existing = await db
    .select()
    .from(printBridges)
    .where(eq(printBridges.bridgeId, bridgeId))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(printBridges)
      .set({
        lastSeenAt: new Date(),
        ...(displayName && { displayName }),
      })
      .where(eq(printBridges.bridgeId, bridgeId))
      .execute();
    return bridgeId;
  }
  const token = `internal-${crypto.randomBytes(16).toString('hex')}`;
  await db
    .insert(printBridges)
    .values({
      bridgeId,
      displayName: displayName || `Tablet (user ${userId})`,
      token,
      isActive: true,
    })
    .execute();
  return bridgeId;
}
