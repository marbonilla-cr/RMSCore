import net from "net";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_HEIGHT_ON: Buffer.from([GS, 0x21, 0x01]),
  DOUBLE_WIDTH_ON: Buffer.from([GS, 0x21, 0x10]),
  DOUBLE_ON: Buffer.from([GS, 0x21, 0x11]),
  NORMAL_SIZE: Buffer.from([GS, 0x21, 0x00]),
  CUT: Buffer.from([GS, 0x56, 0x00]),
  PARTIAL_CUT: Buffer.from([GS, 0x56, 0x01]),
  FEED_LINES: (n: number) => Buffer.from([ESC, 0x64, n]),
  LINE: Buffer.from([LF]),
};

const CP858_MAP: Record<number, number> = {
  0xc1: 0xb5, // Á
  0xc9: 0x90, // É
  0xcd: 0xd6, // Í
  0xd3: 0xe0, // Ó
  0xda: 0xe9, // Ú
  0xe1: 0xa0, // á
  0xe9: 0x82, // é
  0xed: 0xa1, // í
  0xf3: 0xa2, // ó
  0xfa: 0xa3, // ú
  0xf1: 0xa4, // ñ
  0xd1: 0xa5, // Ñ
  0xfc: 0x81, // ü
  0xdc: 0x9a, // Ü
  0xbf: 0xa8, // ¿
  0xa1: 0xad, // ¡
  0xb0: 0xf8, // °
  0xa2: 0xbd, // ¢ (for ₡ fallback)
};

function encodeText(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (CP858_MAP[code] !== undefined) {
      bytes.push(CP858_MAP[code]);
    } else if (code === 0x20a1) {
      bytes.push(0xbd);
    } else if (code <= 0xff) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }
  return Buffer.from(bytes);
}

function line(text: string): Buffer {
  return Buffer.concat([encodeText(text), CMD.LINE]);
}

function divider(width: number = 42): Buffer {
  return line("-".repeat(width));
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.substring(0, width);
  return text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  if (text.length >= width) return text.substring(0, width);
  return " ".repeat(width - text.length) + text;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("es-CR");
}

interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  total: number;
}

interface TaxBreakdownEntry {
  taxName: string;
  taxRate: string;
  inclusive: boolean;
  totalAmount: number;
}

interface ReceiptData {
  businessName: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  legalNote: string;
  orderNumber: string;
  tableName: string;
  items: ReceiptItem[];
  totalAmount: number;
  totalDiscounts?: number;
  totalTaxes?: number;
  taxBreakdown?: TaxBreakdownEntry[];
  paymentMethod: string;
  clientName?: string;
  cashierName?: string;
  date: string;
}

export function buildReceiptBuffer(data: ReceiptData, paperWidth: number = 80): Buffer {
  const cols = paperWidth === 58 ? 32 : 42;
  const parts: Buffer[] = [];

  parts.push(CMD.INIT);
  parts.push(Buffer.from([ESC, 0x74, 19])); // Select code page 858 (CP858 Western European)

  parts.push(CMD.ALIGN_CENTER);
  if (data.businessName) {
    parts.push(CMD.DOUBLE_ON);
    parts.push(line(data.businessName));
    parts.push(CMD.NORMAL_SIZE);
  }
  if (data.legalName) {
    parts.push(CMD.BOLD_ON);
    parts.push(line(data.legalName));
    parts.push(CMD.BOLD_OFF);
  }
  if (data.taxId) parts.push(line(`Ced: ${data.taxId}`));
  if (data.address) parts.push(line(data.address));
  if (data.phone) parts.push(line(`Tel: ${data.phone}`));
  if (data.email) parts.push(line(data.email));

  parts.push(divider(cols));

  parts.push(CMD.ALIGN_LEFT);
  const orderLine = `Orden: ${data.orderNumber}`;
  const tableStr = data.tableName;
  const spacing = cols - orderLine.length - tableStr.length;
  if (spacing > 0) {
    parts.push(CMD.BOLD_ON);
    parts.push(line(orderLine + " ".repeat(spacing) + tableStr));
    parts.push(CMD.BOLD_OFF);
  } else {
    parts.push(CMD.BOLD_ON);
    parts.push(line(orderLine));
    parts.push(line(tableStr));
    parts.push(CMD.BOLD_OFF);
  }
  parts.push(line(data.date));
  if (data.cashierName) parts.push(line(`Cajero: ${data.cashierName}`));
  if (data.clientName) parts.push(line(`Cliente: ${data.clientName}`));

  parts.push(divider(cols));

  const nameW = cols - 18;
  const header = padRight("Articulo", nameW) + padLeft("Cant", 5) + padLeft("Precio", 7) + padLeft("Total", 7);
  parts.push(CMD.BOLD_ON);
  parts.push(line(header));
  parts.push(CMD.BOLD_OFF);
  parts.push(line("-".repeat(cols)));

  for (const item of data.items) {
    const nameStr = item.name.length > nameW ? item.name.substring(0, nameW) : item.name;
    const row = padRight(nameStr, nameW) +
      padLeft(String(item.qty), 5) +
      padLeft(formatCurrency(item.price), 7) +
      padLeft(formatCurrency(item.total), 7);
    parts.push(line(row));
  }

  parts.push(divider(cols));

  const subtotal = data.items.reduce((s, i) => s + i.total, 0);
  const subLabel = "Subtotal";
  const subValue = formatCurrency(subtotal);
  parts.push(line(padRight(subLabel, cols - subValue.length - 1) + " " + subValue));

  if (data.taxBreakdown && data.taxBreakdown.length > 0) {
    for (const tb of data.taxBreakdown) {
      const tLabel = `${tb.taxName} (${tb.taxRate}%)${tb.inclusive ? " incl." : ""}`;
      const tValue = (tb.inclusive ? "" : "+") + formatCurrency(tb.totalAmount);
      parts.push(line(padRight(tLabel, cols - tValue.length - 1) + " " + tValue));
    }
  } else {
    const tLabel = "Impuestos";
    const tValue = formatCurrency(0);
    parts.push(line(padRight(tLabel, cols - tValue.length - 1) + " " + tValue));
  }

  {
    const dLabel = "Descuentos";
    const dValue = data.totalDiscounts && data.totalDiscounts > 0 ? "-" + formatCurrency(data.totalDiscounts) : formatCurrency(0);
    parts.push(line(padRight(dLabel, cols - dValue.length - 1) + " " + dValue));
  }

  parts.push(CMD.DOUBLE_ON);
  parts.push(CMD.BOLD_ON);
  const totalLabel = "TOTAL A PAGAR";
  const totalValue = formatCurrency(data.totalAmount);
  const totalSpacing = cols / 2 - totalLabel.length - totalValue.length;
  parts.push(line(totalLabel + " ".repeat(Math.max(totalSpacing, 2)) + totalValue));
  parts.push(CMD.NORMAL_SIZE);
  parts.push(CMD.BOLD_OFF);

  parts.push(CMD.LINE);
  parts.push(CMD.BOLD_ON);
  parts.push(line(`Pago: ${data.paymentMethod}`));
  parts.push(CMD.BOLD_OFF);

  parts.push(divider(cols));

  parts.push(CMD.ALIGN_CENTER);
  parts.push(CMD.BOLD_ON);
  parts.push(line("Gracias por su visita!"));
  parts.push(CMD.BOLD_OFF);

  if (data.legalNote) {
    parts.push(CMD.LINE);
    parts.push(line(data.legalNote));
  }

  parts.push(CMD.FEED_LINES(4));
  parts.push(CMD.PARTIAL_CUT);

  return Buffer.concat(parts);
}

export function sendToPrinter(
  ip: string,
  port: number,
  data: Buffer,
  timeoutMs: number = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`Timeout: no se pudo conectar a ${ip}:${port}`));
      }
    }, timeoutMs);

    socket.connect(port, ip, () => {
      socket.write(data, () => {
        clearTimeout(timeout);
        resolved = true;
        socket.end();
        resolve();
      });
    });

    socket.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        socket.destroy();
        reject(new Error(`Error de impresora (${ip}:${port}): ${err.message}`));
      }
    });

    socket.on("close", () => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
      }
    });
  });
}
