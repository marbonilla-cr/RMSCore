type WSCallback = (data: any) => void;

class WSManager {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WSCallback>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data);
        const cbs = this.listeners.get(type);
        if (cbs) cbs.forEach((cb) => cb(payload));
      } catch {}
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  on(type: string, cb: WSCallback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    return () => {
      this.listeners.get(type)?.delete(cb);
    };
  }
}

export const wsManager = new WSManager();
