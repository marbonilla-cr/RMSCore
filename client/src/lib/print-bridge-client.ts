/**
 * Print bridge client for Android app: connects to /ws with session cookie,
 * sends register_as_print_bridge, and forwards PRINT_JOB to the native TCP plugin.
 * Only runs when Capacitor native (Android) and PrintTcp plugin are available.
 */

import { sendToPrinter, isPrintTcpAvailable } from "./capacitor-print";

const WS_RECONNECT_DELAY_MS = 5000;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = false;

function getWsUrl(): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const proto = base.startsWith("https") ? "wss:" : "ws:";
  const host = base.replace(/^https?:\/\//, "");
  return `${proto}//${host}/ws`;
}

function connect(): void {
  if (!isPrintTcpAvailable() || !mounted) return;
  const url = getWsUrl();
  try {
    ws = new WebSocket(url);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: "register_as_print_bridge" }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "CONNECTED") {
          console.log("[print-bridge] Registrado:", msg.bridgeId);
          return;
        }
        if (msg.type === "AUTH_ERROR") {
          console.warn("[print-bridge] Auth error:", msg.message);
          return;
        }
        if (msg.type === "PRINT_JOB") {
          const { printerIp, printerPort, payload } = msg;
          if (printerIp && payload) {
            const port = typeof printerPort === "number" ? printerPort : 9100;
            sendToPrinter({ host: printerIp, port, dataBase64: payload })
              .then((r) => {
                if (!r.success && ws?.readyState === WebSocket.OPEN) {
                  try {
                    ws.send(JSON.stringify({ type: "PRINT_ACK", printerId: msg.printerId, success: false }));
                  } catch (_) {}
                }
              })
              .catch(() => {});
          }
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      ws = null;
      if (mounted && isPrintTcpAvailable()) {
        reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  } catch (e) {
    if (mounted) reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
  }
}

/**
 * Start the print bridge client when running in Capacitor Android with session.
 * Call once when the app mounts (e.g. inside AuthProvider after login).
 */
export function startPrintBridgeClient(): void {
  if (!isPrintTcpAvailable()) return;
  mounted = true;
  connect();
}

/**
 * Stop the print bridge client (e.g. on logout or unmount).
 */
export function stopPrintBridgeClient(): void {
  mounted = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function isPrintBridgeAvailable(): boolean {
  return isPrintTcpAvailable();
}
