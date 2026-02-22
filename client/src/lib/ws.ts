type WSCallback = (data: any) => void;

class WSManager {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WSCallback>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private _connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();

  get connected() {
    return this._connected;
  }

  private setConnected(val: boolean) {
    if (this._connected !== val) {
      this._connected = val;
      this.connectionListeners.forEach(cb => cb(val));
    }
  }

  onConnectionChange(cb: (connected: boolean) => void) {
    this.connectionListeners.add(cb);
    return () => { this.connectionListeners.delete(cb); };
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(1000);
      return;
    }

    this.ws.onopen = () => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.setConnected(true);
      this.missedPongs = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data);
        if (type === "pong") {
          this.missedPongs = 0;
          return;
        }
        const cbs = this.listeners.get(type);
        if (cbs) cbs.forEach((cb) => cb(payload));
      } catch {}
    };

    this.ws.onclose = () => {
      this.setConnected(false);
      this.stopHeartbeat();
      this.scheduleReconnect(500);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(delay: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.missedPongs++;
        if (this.missedPongs > 2) {
          this.ws.close();
          return;
        }
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          this.ws.close();
        }
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setConnected(false);
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
