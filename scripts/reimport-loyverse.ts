import fs from "fs";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL!;

function cleanCategoryName(name: string): string {
  if (!name) return name;
  return name.replace(/^\d+-/, "").trim();
}

function mapPaymentCode(code: string): number {
  switch (code) {
    case "CASH": return 1;
    case "TARJETA": return 2;
    case "SINPE": return 3;
    default: return 2;
  }
}

function csvTimestampToUtc(ts: string): string | null {
  if (!ts || ts.trim() === "") return null;
  const parts = ts.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return null;
  const [, yr, mo, dy, hr, mi, se] = parts;
  return `${yr}-${mo}-${dy}T${hr}:${mi}:${se}.000Z`;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log("[REIMPORT] Starting clean Loyverse reimport...");

  const existingCheck = await pool.query(
    "SELECT COUNT(*) as cnt FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'"
  );
  if (parseInt(existingCheck.rows[0].cnt) > 0) {
    console.log("[REIMPORT] LOYVERSE_POS records already exist. Aborting to prevent duplicates.");
    await pool.end();
    return;
  }

  const ledgerCsv = fs.readFileSync(
    "attached_assets/sales_ledger_items_import_v2_with_order_id_1771384006312.csv",
    "utf-8"
  );
  const ledgerLines = ledgerCsv.split("\n").filter((l) => l.trim());
  const ledgerRows = ledgerLines.slice(1);

  console.log(`[REIMPORT] Processing ${ledgerRows.length} ledger items...`);

  const BATCH_SIZE = 200;
  let ledgerInserted = 0;

  for (let i = 0; i < ledgerRows.length; i += BATCH_SIZE) {
    const batch = ledgerRows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: any[] = [];
    let p = 1;

    for (const row of batch) {
      const cols = parseCsvLine(row);
      if (cols.length < 21) continue;

      const businessDate = cols[0];
      const orderId = parseInt(cols[3]) || null;
      const productCode = cols[6] || null;
      const productName = cols[7] || null;
      const categoryCode = cols[9] || null;
      const rawCategoryName = cols[10] || null;
      const categoryName = rawCategoryName ? cleanCategoryName(rawCategoryName) : null;
      const qty = parseInt(cols[11]) || 0;
      const unitPrice = parseFloat(cols[12]) || 0;
      const lineSubtotal = parseFloat(cols[13]) || 0;
      const paidAtCr = cols[20] || null;
      const createdAtUtc = csvTimestampToUtc(paidAtCr || `${businessDate} 12:00:00`);
      const paidAtUtc = paidAtCr ? csvTimestampToUtc(paidAtCr) : null;

      placeholders.push(
        `($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},'LOYVERSE_POS')`
      );
      params.push(businessDate, createdAtUtc, orderId, productCode, productName,
        categoryCode, categoryName, qty, unitPrice, lineSubtotal, paidAtUtc, "PAID");
      p += 12;
    }

    if (placeholders.length > 0) {
      await pool.query(
        `INSERT INTO sales_ledger_items 
          (business_date, created_at, order_id, product_code_snapshot, product_name_snapshot, 
           category_code_snapshot, category_name_snapshot, qty, unit_price, line_subtotal, 
           paid_at, status, origin) 
          VALUES ${placeholders.join(",")}`,
        params
      );
      ledgerInserted += placeholders.length;
    }

    if ((i + BATCH_SIZE) % 5000 < BATCH_SIZE) {
      console.log(`[REIMPORT] Ledger progress: ${ledgerInserted}/${ledgerRows.length}`);
    }
  }

  console.log(`[REIMPORT] Ledger complete: ${ledgerInserted} rows inserted.`);

  const paymentsCsv = fs.readFileSync(
    "attached_assets/payments_import_prefer_tarjeta_1771424281023.csv",
    "utf-8"
  );
  const paymentLines = paymentsCsv.split("\n").filter((l) => l.trim());
  const paymentRows = paymentLines.slice(1);

  console.log(`[REIMPORT] Processing ${paymentRows.length} payments...`);

  let paymentsInserted = 0;
  let paymentsSkipped = 0;

  for (let i = 0; i < paymentRows.length; i += BATCH_SIZE) {
    const batch = paymentRows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: any[] = [];
    let p = 1;

    for (const row of batch) {
      const cols = parseCsvLine(row);
      if (cols.length < 7) continue;

      const orderId = parseInt(cols[1]) || null;
      const businessDate = cols[2];
      const methodCode = cols[3];
      const amount = parseFloat(cols[4]) || 0;
      const status = cols[5] || "PAID";
      const paidAtCr = cols[6] || null;

      if (status === "PENDING" || !orderId) {
        paymentsSkipped++;
        continue;
      }

      const paymentMethodId = mapPaymentCode(methodCode);
      const paidAtUtc = csvTimestampToUtc(paidAtCr || `${businessDate} 12:00:00`);

      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},1)`);
      params.push(orderId, amount, paymentMethodId, paidAtUtc, "PAID", businessDate);
      p += 6;
    }

    if (placeholders.length > 0) {
      await pool.query(
        `INSERT INTO payments 
          (order_id, amount, payment_method_id, paid_at, status, business_date, cashier_user_id) 
          VALUES ${placeholders.join(",")}`,
        params
      );
      paymentsInserted += placeholders.length;
    }
  }

  console.log(`[REIMPORT] Payments complete: ${paymentsInserted} inserted, ${paymentsSkipped} skipped.`);

  console.log("\n=== VERIFICATION ===");

  const verifyHours = await pool.query(`
    SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') as cr_hour,
           COUNT(*) as cnt
    FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'
      AND business_date >= '2025-12-01' AND business_date <= '2025-12-31'
    GROUP BY cr_hour ORDER BY cr_hour
  `);
  console.log("December hour distribution (CR time):");
  verifyHours.rows.forEach((r: any) => console.log(`  Hour ${r.cr_hour}: ${r.cnt}`));

  const verifyDow = await pool.query(`
    SELECT EXTRACT(DOW FROM business_date::date) as dow,
           to_char(business_date::date, 'Dy') as day_name,
           COUNT(*) as cnt
    FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'
      AND business_date >= '2025-12-01' AND business_date <= '2025-12-31'
    GROUP BY dow, day_name ORDER BY dow
  `);
  console.log("December day-of-week distribution:");
  verifyDow.rows.forEach((r: any) => console.log(`  ${r.day_name} (dow=${r.dow}): ${r.cnt}`));

  const verifyMismatch = await pool.query(`
    SELECT COUNT(*) as cnt FROM sales_ledger_items 
    WHERE origin = 'LOYVERSE_POS'
      AND business_date != ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date::text
  `);
  console.log(`Date mismatches: ${verifyMismatch.rows[0].cnt}`);

  const verifyCategories = await pool.query(`
    SELECT DISTINCT category_name_snapshot FROM sales_ledger_items
    WHERE origin = 'LOYVERSE_POS' AND category_name_snapshot ~ '^\\d+-'
  `);
  console.log(`Categories still with numeric prefix: ${verifyCategories.rows.length}`);

  const verifyTotals = await pool.query(`
    SELECT COUNT(*) as ledger_count,
           COUNT(DISTINCT order_id) as order_count,
           SUM(line_subtotal::numeric) as total_sales
    FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'
  `);
  const lt = verifyTotals.rows[0];
  console.log(`Totals: ${lt.ledger_count} items, ${lt.order_count} orders, total=₡${Math.round(lt.total_sales).toLocaleString()}`);

  await pool.end();
  console.log("\n[REIMPORT] Done!");
}

main().catch(console.error);
