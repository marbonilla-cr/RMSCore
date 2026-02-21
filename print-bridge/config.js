const path = require("path");
const fs = require("fs");

const localConfigPath = path.join(__dirname, "config.local.json");

let localConfig = {};
if (fs.existsSync(localConfigPath)) {
  try {
    localConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
  } catch (err) {
    console.error("Error leyendo config.local.json:", err.message);
  }
}

module.exports = {
  serverUrl: process.env.BRIDGE_SERVER_URL || localConfig.serverUrl || "wss://rms.restlaantigua.com/ws",
  bridgeId: process.env.BRIDGE_ID || localConfig.bridgeId || "bridge-001",
  bridgeToken: process.env.BRIDGE_TOKEN || localConfig.bridgeToken || "bridge-token-local",
  reconnectInterval: parseInt(process.env.BRIDGE_RECONNECT_MS || "5000", 10),
  pingInterval: parseInt(process.env.BRIDGE_PING_MS || "30000", 10),
  printers: localConfig.printers || [
    {
      name: "Impresora Caja",
      type: "caja",
      ipAddress: "192.168.2.200",
      port: 9100,
      paperWidth: 80,
      enabled: true,
    },
  ],
};
