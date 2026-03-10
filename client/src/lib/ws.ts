type WSCallback = (data: any) => void;

type WSState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "PAUSED";

class WSManager {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WSCallback>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private _connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  private _state: WSState = "DISCONNECTED";
  private backoffStep = 0;

  private static readonly BACKOFF_DELAYS = [500, 1000, 2000, 4000, 8000, 16000, 30000];
  private static readonly JITTER_MAX = 500;

  get connected() {
    return this._connected;
  }

  get state() {
    return this._state;
  }

  private setState(s: WSState) {
    this._state = s;
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
    if (this._state === "PAUSED") return;
    if (this._state === "CONNECTING" || this._state === "CONNECTED") return;

    this.setState("CONNECTING");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.setState("DISCONNECTED");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.clearReconnectTimer();
      this.setState("CONNECTED");
      this.setConnected(true);
      this.missedPongs = 0;
      this.backoffStep = 0;
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
      if (this._state !== "PAUSED") {
        this.setState("DISCONNECTED");
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this._state === "PAUSED") return;
    this.clearReconnectTimer();
    const idx = Math.min(this.backoffStep, WSManager.BACKOFF_DELAYS.length - 1);
    const base = WSManager.BACKOFF_DELAYS[idx];
    const jitter = Math.floor(Math.random() * WSManager.JITTER_MAX);
    const delay = base + jitter;
    this.backoffStep++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

  pause() {
    this.setState("PAUSED");
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setConnected(false);
    this.backoffStep = 0;
  }

  resume() {
    if (this._state === "PAUSED" || this._state === "DISCONNECTED") {
      this.setState("DISCONNECTED");
      this.backoffStep = 0;
      this.connect();
    }
  }

  disconnect() {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setState("DISCONNECTED");
    this.setConnected(false);
    this.backoffStep = 0;
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
