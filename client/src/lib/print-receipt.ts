interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  total: number;
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
  paymentMethod: string;
  clientName?: string;
  cashierName?: string;
  date: string;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatCurrency(amount: number): string {
  return `₡${amount.toLocaleString("es-CR")}`;
}

export function printReceipt(data: ReceiptData) {
  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left;padding:1px 0;">${escapeHtml(item.name)}</td>
        <td style="text-align:center;padding:1px 4px;">${item.qty}</td>
        <td style="text-align:right;padding:1px 0;">${formatCurrency(item.price)}</td>
        <td style="text-align:right;padding:1px 0;">${formatCurrency(item.total)}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tiquete</title>
  <style>
    @page {
      margin: 2mm;
      size: 80mm auto;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      width: 76mm;
      max-width: 76mm;
      color: #000;
      background: #fff;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider {
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    .header { margin-bottom: 4px; }
    .header h1 { font-size: 16px; margin-bottom: 2px; }
    .header p { font-size: 10px; line-height: 1.3; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; padding: 2px 0; border-bottom: 1px solid #000; }
    td { font-size: 11px; }
    .total-row td { font-size: 14px; font-weight: bold; padding-top: 4px; }
    .footer { margin-top: 6px; }
    .footer p { font-size: 9px; line-height: 1.3; }
    .legal-note { font-size: 8px; margin-top: 6px; line-height: 1.2; text-align: center; font-style: italic; }
    .print-btn {
      display: block;
      width: 100%;
      padding: 12px;
      margin: 12px 0 4px;
      background: #000;
      color: #fff;
      border: none;
      font-size: 16px;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      cursor: pointer;
      border-radius: 4px;
    }
    .print-btn:active { background: #333; }
    @media print {
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header center">
    ${data.businessName ? `<h1>${escapeHtml(data.businessName)}</h1>` : ""}
    ${data.legalName ? `<p class="bold">${escapeHtml(data.legalName)}</p>` : ""}
    ${data.taxId ? `<p>Céd: ${escapeHtml(data.taxId)}</p>` : ""}
    ${data.address ? `<p>${escapeHtml(data.address)}</p>` : ""}
    ${data.phone ? `<p>Tel: ${escapeHtml(data.phone)}</p>` : ""}
    ${data.email ? `<p>${escapeHtml(data.email)}</p>` : ""}
  </div>

  <div class="divider"></div>

  <div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0;">
    <span class="bold">Orden: ${escapeHtml(data.orderNumber)}</span>
    <span>${escapeHtml(data.tableName)}</span>
  </div>
  <div style="font-size:10px;margin-bottom:2px;">
    ${escapeHtml(data.date)}
  </div>
  ${data.cashierName ? `<div style="font-size:10px;">Cajero: ${escapeHtml(data.cashierName)}</div>` : ""}
  ${data.clientName ? `<div style="font-size:10px;">Cliente: ${escapeHtml(data.clientName)}</div>` : ""}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th>Artículo</th>
        <th style="text-align:center;">Cant</th>
        <th style="text-align:right;">Precio</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td style="text-align:right;" colspan="3">${formatCurrency(data.totalAmount)}</td>
    </tr>
  </table>

  <div style="font-size:11px;margin-top:4px;">
    <span class="bold">Pago:</span> ${escapeHtml(data.paymentMethod)}
  </div>

  <div class="divider"></div>

  <div class="footer center">
    <p class="bold">¡Gracias por su visita!</p>
  </div>

  ${data.legalNote ? `<div class="legal-note">${escapeHtml(data.legalNote)}</div>` : ""}

  <div class="no-print">
    <button class="print-btn" onclick="window.print()">IMPRIMIR TIQUETE</button>
    <button class="print-btn" style="background:#666;margin-top:4px;" onclick="window.close()">CERRAR</button>
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "width=320,height=600");
  if (!printWindow) {
    alert("No se pudo abrir la ventana de impresión. Permite los popups en tu navegador.");
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();

  const triggerPrint = () => {
    printWindow.focus();
    try {
      printWindow.print();
    } catch (e) {
      console.error("Print error:", e);
    }
  };

  if (printWindow.document.readyState === "complete") {
    setTimeout(triggerPrint, 300);
  } else {
    printWindow.onload = () => {
      setTimeout(triggerPrint, 300);
    };
    setTimeout(triggerPrint, 1500);
  }
}
