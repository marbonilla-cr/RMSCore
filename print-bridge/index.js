const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const VALID_PRINTER = /^[a-zA-Z0-9_\-]+$/;

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let alive = false;

function log(msg) {
  const ts = new Date().toLocaleTimeString("es-CR", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function connect() {
  log(`Conectando a ${config.serverUrl} ...`);

  ws = new WebSocket(config.serverUrl, {
    headers: { "x-bridge-token": config.bridgeToken },
  });

  ws.on("open", () => {
    log("Conexion establecida");
    alive = true;

    ws.send(JSON.stringify({
      type: "print_bridge_register",
      payload: { bridgeId: config.bridgeId },
    }));
    log(`Registrado como: ${config.bridgeId}`);

    startPing();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "pong") {
        alive = true;
        return;
      }

      if (msg.type === "print_job") {
        handlePrintJob(msg.payload);
        return;
      }

      log(`Mensaje recibido: ${msg.type}`);
    } catch (err) {
      log(`Error parseando mensaje: ${err.message}`);
    }
  });

  ws.on("close", (code, reason) => {
    log(`Desconectado (code=${code}). Reconectando en ${config.reconnectInterval / 1000}s...`);
    cleanup();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log(`Error WebSocket: ${err.message}`);
  });
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (!alive) {
      log("Sin respuesta al ping. Cerrando conexion...");
      ws.terminate();
      return;
    }

    alive = false;
    ws.send(JSON.stringify({ type: "ping" }));
  }, config.pingInterval);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function cleanup() {
  stopPing();
  ws = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, config.reconnectInterval);
}

function validatePrinter(name) {
  if (!name) return null;
  if (!VALID_PRINTER.test(name)) {
    log(`Nombre de impresora invalido: ${name}`);
    return null;
  }
  return name;
}

function handlePrintJob(job) {
  if (!job) {
    log("Trabajo de impresion vacio, ignorando");
    return;
  }

  const { jobType, destination, payload } = job;
  log(`Trabajo recibido: tipo=${jobType || "desconocido"}, destino=${destination || "default"}`);

  if (jobType === "test") {
    log(">>> TRABAJO DE PRUEBA RECIBIDO <<<");
    log(`    Contenido: ${JSON.stringify(payload)}`);
    return;
  }

  if (jobType === "raw" && payload?.raw) {
    printRaw(payload.raw, destination);
    return;
  }

  if (jobType === "receipt" && payload?.text) {
    printText(payload.text, destination);
    return;
  }

  log(`Tipo de trabajo no soportado: ${jobType}`);
  log(`Payload: ${JSON.stringify(job).substring(0, 200)}`);
}

function printText(text, destination) {
  const printer = validatePrinter(destination) || validatePrinter(config.printerName);

  if (!printer) {
    log("No hay impresora configurada. Imprimiendo en consola:");
    console.log("─".repeat(42));
    console.log(text);
    console.log("─".repeat(42));
    return;
  }

  const lp = spawn("lp", ["-d", printer]);

  lp.stdin.write(text);
  lp.stdin.end();

  lp.stdout.on("data", (data) => {
    log(`Impreso en ${printer}: ${data.toString().trim()}`);
  });

  lp.stderr.on("data", (data) => {
    log(`Error imprimiendo: ${data.toString().trim()}`);
  });

  lp.on("error", (err) => {
    log(`Error ejecutando lp: ${err.message}`);
  });
}

function printRaw(rawBase64, destination) {
  const printer = validatePrinter(destination) || validatePrinter(config.printerName);
  const buffer = Buffer.from(rawBase64, "base64");

  if (!printer) {
    log(`Datos raw recibidos (${buffer.length} bytes). No hay impresora configurada.`);
    return;
  }

  const tmpFile = path.join(__dirname, `.tmp_print_${Date.now()}.bin`);

  fs.writeFileSync(tmpFile, buffer);

  const lp = spawn("lp", ["-d", printer, "-o", "raw", tmpFile]);

  lp.stdout.on("data", (data) => {
    log(`Raw impreso en ${printer}: ${data.toString().trim()}`);
  });

  lp.stderr.on("data", (data) => {
    log(`Error imprimiendo raw: ${data.toString().trim()}`);
  });

  lp.on("close", () => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  lp.on("error", (err) => {
    log(`Error ejecutando lp: ${err.message}`);
    try { fs.unlinkSync(tmpFile); } catch {}
  });
}

process.on("SIGINT", () => {
  log("Cerrando Print Bridge...");
  if (ws) ws.close();
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Cerrando Print Bridge...");
  if (ws) ws.close();
  cleanup();
  process.exit(0);
});

log("=== Print Bridge iniciando ===");
log(`Bridge ID: ${config.bridgeId}`);
log(`Servidor:  ${config.serverUrl}`);
log(`Impresora: ${config.printerName || "(consola)"}`);
log("");
connect();
