module.exports = {
  serverUrl: process.env.BRIDGE_SERVER_URL || "wss://rms.restlaantigua.com/ws",
  bridgeToken: process.env.BRIDGE_TOKEN || "restaurante-bridge-2024",
  bridgeId: process.env.BRIDGE_ID || "bridge-cocina-01",
  reconnectInterval: parseInt(process.env.BRIDGE_RECONNECT_MS || "5000", 10),
  pingInterval: parseInt(process.env.BRIDGE_PING_MS || "30000", 10),
  printerName: process.env.BRIDGE_PRINTER || null,
};
