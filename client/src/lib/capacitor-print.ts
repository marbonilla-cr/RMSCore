/**
 * Wrapper for Capacitor PrintTcp plugin (Android only).
 * When running in the browser/PWA, Capacitor is not available; calls no-op or return safe defaults.
 */

export function isPrintTcpAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const Cap = (window as any).Capacitor;
  return !!(Cap?.isNativePlatform?.() && Cap?.Plugins?.PrintTcp);
}

export async function sendToPrinter(options: {
  host: string;
  port: number;
  dataBase64: string;
}): Promise<{ success: boolean; error?: string }> {
  const Cap = (window as any).Capacitor;
  if (!Cap?.Plugins?.PrintTcp) return { success: false, error: "PrintTcp no disponible (solo en app Android)" };
  const result = await Cap.Plugins.PrintTcp.sendToPrinter(options);
  return result ?? { success: false, error: "Sin respuesta" };
}

export async function discoverPrinters(options?: {
  port?: number;
  timeoutMs?: number;
}): Promise<{ host: string; port: number }[]> {
  const Cap = (window as any).Capacitor;
  if (!Cap?.Plugins?.PrintTcp) return [];
  const result = await Cap.Plugins.PrintTcp.discoverPrinters(options);
  return result?.hosts ?? [];
}
