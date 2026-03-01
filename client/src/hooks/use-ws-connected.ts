import { useState, useEffect } from "react";
import { wsManager } from "@/lib/ws";

export function useWsConnected(): boolean {
  const [connected, setConnected] = useState(wsManager.connected);
  useEffect(() => {
    setConnected(wsManager.connected);
    return wsManager.onConnectionChange(setConnected);
  }, []);
  return connected;
}
