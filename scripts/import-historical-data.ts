import { db } from "../server/db";
import { salesLedgerItems, payments } from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

const BATCH_SIZE = 500;

function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function toIntOrNull(val: string): number | null {
  if (!val || val === "") return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toTimestampOrNull(val: string): Date | null {
  if (!val || val === "") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function importSalesLedger() {
  const filePath = path.join(process.cwd(), "attached_assets/sales_ledger_items_import_v2_with_order_id_1771384006312.csv");
  console.log("Parsing sales ledger CSV...");
  const rows = parseCSV(filePath);
  console.log(`Parsed ${rows.length} sales ledger rows`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch.map(r => ({
      businessDate: r.business_date,
      createdAt: toTimestampOrNull(r.paid_at) || new Date(),
      tableId: toIntOrNull(r.table_id),
      tableNameSnapshot: r.table_name_snapshot || null,
      orderId: toIntOrNull(r.order_id),
      orderItemId: toIntOrNull(r.order_item_id),
      productId: toIntOrNull(r.product_id),
      productCodeSnapshot: r.product_code_snapshot || null,
      productNameSnapshot: r.product_name_snapshot || null,
      categoryId: toIntOrNull(r.category_id),
      categoryCodeSnapshot: r.category_code_snapshot || null,
      categoryNameSnapshot: r.category_name_snapshot || null,
      qty: parseInt(r.qty, 10) || 0,
      unitPrice: r.unit_price || "0",
      lineSubtotal: r.line_subtotal || "0",
      origin: r.origin || "POS",
      createdByUserId: toIntOrNull(r.created_by_user_id),
      responsibleWaiterId: toIntOrNull(r.responsible_waiter_id),
      status: r.status || "PAID",
      sentToKitchenAt: toTimestampOrNull(r.sent_to_kitchen_at),
      kdsReadyAt: toTimestampOrNull(r.kds_ready_at),
      paidAt: toTimestampOrNull(r.paid_at),
    }));
    await db.insert(salesLedgerItems).values(values);
    inserted += batch.length;
    if (inserted % 5000 === 0 || inserted === rows.length) {
      console.log(`  Sales ledger: ${inserted}/${rows.length} inserted`);
    }
  }
  console.log(`Sales ledger import complete: ${inserted} rows inserted`);
}

async function importPayments() {
  const filePath = path.join(process.cwd(), "attached_assets/payments_import_from_receipts_1771384006312.csv");
  console.log("Parsing payments CSV...");
  const rows = parseCSV(filePath);
  console.log(`Parsed ${rows.length} payment rows`);

  const methodMap: Record<string, number> = {
    "CASH": 1,
    "CARD": 2,
    "SINPE": 3,
    "TARJETA": 2,
  };

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch
      .filter(r => {
        const orderId = toIntOrNull(r.order_id);
        if (!orderId) { skipped++; return false; }
        return true;
      })
      .map(r => {
        const methodCode = r.method_code || "CASH";
        const paymentMethodId = methodMap[methodCode] || 1;
        const paidAtDate = toTimestampOrNull(r.paid_at);
        const businessDate = r.business_date || (paidAtDate ? paidAtDate.toISOString().slice(0, 10) : "2024-01-01");
        return {
          orderId: parseInt(r.order_id, 10),
          amount: r.amount || "0",
          paymentMethodId,
          paidAt: paidAtDate || new Date(),
          cashierUserId: 1,
          status: r.status || "PAID",
          businessDate,
        };
      });
    if (values.length > 0) {
      await db.insert(payments).values(values);
      inserted += values.length;
    }
    if (inserted % 5000 === 0 || (i + BATCH_SIZE >= rows.length)) {
      console.log(`  Payments: ${inserted}/${rows.length} inserted (${skipped} skipped)`);
    }
  }
  console.log(`Payments import complete: ${inserted} rows inserted, ${skipped} skipped`);
}

async function main() {
  console.log("=== Starting Historical Data Import ===");
  console.log("");

  const [{ count: existingCount }] = await db.execute<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM sales_ledger_items WHERE origin = 'POS' AND product_name_snapshot IS NOT NULL`
  ) as any;
  if (parseInt(existingCount, 10) > 50000) {
    console.log(`SAFETY CHECK: Already ${existingCount} rows in sales_ledger_items. Skipping to avoid duplicates.`);
    console.log("If you need to re-import, delete the existing imported data first.");
    process.exit(0);
  }

  try {
    console.log("--- Step 1: Import Sales Ledger Items ---");
    await importSalesLedger();
    console.log("");

    console.log("--- Step 2: Import Payments ---");
    await importPayments();
    console.log("");

    console.log("=== Import Complete ===");
  } catch (err) {
    console.error("Import failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

main();
