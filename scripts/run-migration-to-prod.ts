import fs from "fs";

const PROD_URL = process.argv[2];
if (!PROD_URL) {
  console.error("Usage: npx tsx scripts/run-migration-to-prod.ts <PRODUCTION_APP_URL>");
  console.error("Example: npx tsx scripts/run-migration-to-prod.ts https://myapp.replit.app");
  process.exit(1);
}

const MIGRATION_KEY = "loyverse-migrate-2026-02-18-xyz";
const ORDER_ID_OFFSET = 200;
const PROD_MAX_ORDER_ID = 121;
const PROD_MAX_PAYMENT_ID = 111;
const BATCH_SIZE = 1000;

const offset = PROD_MAX_ORDER_ID + ORDER_ID_OFFSET;

async function sendBatch(endpoint: string, rows: any[], batchNum: number, totalBatches: number): Promise<boolean> {
  const url = `${PROD_URL}${endpoint}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-migration-key": MIGRATION_KEY,
      },
      body: JSON.stringify({ rows }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error(`  ERROR batch ${batchNum}/${totalBatches}: ${JSON.stringify(data)}`);
      return false;
    }
    console.log(`  Batch ${batchNum}/${totalBatches}: inserted ${data.inserted} rows`);
    return true;
  } catch (e: any) {
    console.error(`  NETWORK ERROR batch ${batchNum}/${totalBatches}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`Migration target: ${PROD_URL}`);
  console.log(`Order ID offset: +${offset}`);
  console.log(`Payment ID offset: +${PROD_MAX_PAYMENT_ID + 100}`);

  const ledgerRows = JSON.parse(fs.readFileSync("/tmp/loyverse_ledger.json", "utf-8"));
  const paymentRows = JSON.parse(fs.readFileSync("/tmp/loyverse_payments.json", "utf-8"));

  console.log(`\nLoaded ${ledgerRows.length} ledger items and ${paymentRows.length} payments`);

  const transformedLedger = ledgerRows.map((r: any) => ({
    ...r,
    order_id: r.order_id + offset,
  }));

  const transformedPayments = paymentRows.map((r: any) => ({
    ...r,
    id: r.id + PROD_MAX_PAYMENT_ID + 100,
    order_id: r.order_id + offset,
  }));

  console.log("\n--- Migrating ledger items ---");
  const ledgerBatches = Math.ceil(transformedLedger.length / BATCH_SIZE);
  let ledgerOk = 0;
  for (let i = 0; i < transformedLedger.length; i += BATCH_SIZE) {
    const batch = transformedLedger.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const ok = await sendBatch("/api/_migrate/loyverse-ledger", batch, batchNum, ledgerBatches);
    if (ok) ledgerOk++;
    else {
      console.error("Stopping due to error.");
      return;
    }
  }
  console.log(`\nLedger complete: ${ledgerOk}/${ledgerBatches} batches OK`);

  console.log("\n--- Migrating payments ---");
  const paymentBatchCount = Math.ceil(transformedPayments.length / BATCH_SIZE);
  let paymentOk = 0;
  for (let i = 0; i < transformedPayments.length; i += BATCH_SIZE) {
    const batch = transformedPayments.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const ok = await sendBatch("/api/_migrate/loyverse-payments", batch, batchNum, paymentBatchCount);
    if (ok) paymentOk++;
    else {
      console.error("Stopping due to error.");
      return;
    }
  }
  console.log(`\nPayments complete: ${paymentOk}/${paymentBatchCount} batches OK`);

  console.log("\n--- Updating sequences ---");
  const seqResp = await fetch(`${PROD_URL}/api/_migrate/update-sequences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-migration-key": MIGRATION_KEY,
    },
    body: JSON.stringify({}),
  });
  const seqData = await seqResp.json();
  console.log("Sequences updated:", seqData);

  console.log("\n=== MIGRATION COMPLETE ===");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
