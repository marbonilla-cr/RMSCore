const net = require("net");
const WebSocket = require("ws");
const config = require("./config");

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let alive = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_INTERVAL = 60000;

const printQueue = [];
let printing = false;

async function processPrintQueue() {
  if (printing || printQueue.length === 0) return;
  printing = true;
  while (printQueue.length > 0) {
    const { printer, data, label } = printQueue.shift();
    try {
      await sendToPrinter(printer, data);
      log(`${label} impreso en ${printer.name} (${data.length} bytes)`);
    } catch (err) {
      log(`Error imprimiendo ${label}: ${err.message}`);
    }
    if (printQueue.length > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  printing = false;
}

function enqueuePrint(printer, data, label) {
  printQueue.push({ printer, data, label });
  processPrintQueue();
}

function log(msg) {
  const ts = new Date().toLocaleTimeString("es-CR", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function validateConfig() {
  if (!config.serverUrl) {
    console.error("ERROR: serverUrl no configurado");
    process.exit(1);
  }
  if (!config.bridgeToken) {
    console.error("ERROR: bridgeToken no configurado");
    process.exit(1);
  }
  if (!config.printers || config.printers.length === 0) {
    log("ADVERTENCIA: No hay impresoras configuradas. Los trabajos se mostraran en consola.");
  }
  config.printers.forEach((p) => {
    if (!p.ipAddress || !p.port) {
      console.error(`ERROR: Impresora "${p.name}" sin ipAddress o port`);
      process.exit(1);
    }
  });
}

function findPrinter(destination) {
  if (!config.printers || config.printers.length === 0) return null;

  if (destination) {
    const match = config.printers.find(
      (p) => p.enabled && (p.name === destination || p.type === destination)
    );
    if (match) return match;
  }

  return config.printers.find((p) => p.enabled) || null;
}

function sendToPrinter(printer, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setNoDelay(true);
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(val);
    };

    const timeout = setTimeout(() => {
      socket.destroy();
      settle(reject, new Error(`Timeout conectando a ${printer.ipAddress}:${printer.port}`));
    }, 8000);

    socket.connect(printer.port, printer.ipAddress, () => {
      const flushed = socket.write(data);
      const finish = () => {
        setTimeout(() => {
          socket.end();
          setTimeout(() => settle(resolve), 100);
        }, 200);
      };
      if (flushed) {
        finish();
      } else {
        socket.once("drain", finish);
      }
    });

    socket.on("close", () => settle(resolve));

    socket.on("error", (err) => {
      if (err.code === "ECONNRESET" && settled) return;
      if (err.code === "ECONNRESET") {
        log(`Impresora cerro conexion (ECONNRESET) - datos probablemente recibidos`);
        settle(resolve);
        return;
      }
      socket.destroy();
      settle(reject, err);
    });
  });
}

function connect() {
  log(`Conectando a ${config.serverUrl} ...`);

  ws = new WebSocket(config.serverUrl, {
    headers: { "x-bridge-token": config.bridgeToken },
  });

  ws.on("open", () => {
    log("Conexion establecida");
    reconnectAttempts = 0;
    alive = true;

    ws.send(
      JSON.stringify({
        type: "print_bridge_register",
        payload: { bridgeId: config.bridgeId },
      })
    );
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

  ws.on("close", (code) => {
    log(`Desconectado (code=${code}).`);
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
  reconnectAttempts++;
  const baseDelay = config.reconnectInterval;
  const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_INTERVAL);
  log(`Intento #${reconnectAttempts} — reconectando en ${(delay / 1000).toFixed(0)}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function handlePrintJob(job) {
  if (!job) {
    log("Trabajo de impresion vacio, ignorando");
    return;
  }

  const { jobType, destination, payload } = job;
  log(
    `Trabajo recibido: tipo=${jobType || "desconocido"}, destino=${destination || "default"}`
  );

  if (jobType === "test") {
    log(">>> TRABAJO DE PRUEBA RECIBIDO <<<");
    log(`    Contenido: ${JSON.stringify(payload)}`);

    const printer = findPrinter(destination);
    if (printer) {
      const testText =
        "=== PRUEBA DE IMPRESION ===\n" +
        `Bridge: ${config.bridgeId}\n` +
        `Impresora: ${printer.name}\n` +
        `Fecha: ${new Date().toLocaleString("es-CR")}\n` +
        "===========================\n\n\n";
      enqueuePrint(printer, Buffer.from(testText), "Prueba");
    }
    return;
  }

  if (jobType === "raw" && payload?.raw) {
    const printer = findPrinter(destination);
    if (!printer) {
      log("No hay impresora disponible para trabajo raw");
      return;
    }
    const buffer = Buffer.from(payload.raw, "base64");
    enqueuePrint(printer, buffer, "Raw");
    return;
  }

  if (jobType === "receipt" && payload?.text) {
    const printer = findPrinter(destination);
    if (!printer) {
      log("No hay impresora disponible. Imprimiendo en consola:");
      console.log("\u2500".repeat(42));
      console.log(payload.text);
      console.log("\u2500".repeat(42));
      return;
    }
    enqueuePrint(printer, Buffer.from(payload.text), "Recibo");
    return;
  }

  log(`Tipo de trabajo no soportado: ${jobType}`);
  log(`Payload: ${JSON.stringify(job).substring(0, 200)}`);
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

validateConfig();

log("=== Print Bridge iniciando ===");
log(`Bridge ID:  ${config.bridgeId}`);
log(`Servidor:   ${config.serverUrl}`);
log(`Impresoras: ${config.printers.length}`);
config.printers.forEach((p) => {
  log(
    `  - ${p.name} (${p.type}) -> ${p.ipAddress}:${p.port} [${p.enabled ? "ON" : "OFF"}]`
  );
});
log("");
connect();
