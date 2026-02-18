import pg from "pg";
import fs from "fs";

const DEV_DB_URL = process.env.DATABASE_URL!;

async function main() {
  const pool = new pg.Pool({ connectionString: DEV_DB_URL });
  const client = await pool.connect();

  console.log("Fetching LOYVERSE_POS ledger items...");
  const ledgerResult = await client.query(
    `SELECT id, business_date, created_at, table_id, table_name_snapshot, order_id, order_item_id,
            product_id, product_code_snapshot, product_name_snapshot, category_id, category_code_snapshot,
            category_name_snapshot, qty, unit_price, line_subtotal, origin, created_by_user_id,
            responsible_waiter_id, status, sent_to_kitchen_at, kds_ready_at, paid_at
     FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS' ORDER BY id`
  );
  console.log(`Fetched ${ledgerResult.rows.length} ledger items`);

  console.log("Fetching linked payments...");
  const paymentResult = await client.query(
    `SELECT p.id, p.order_id, p.split_id, p.amount, p.payment_method_id, p.paid_at,
            p.cashier_user_id, p.status, p.client_name_snapshot, p.client_email_snapshot,
            p.business_date, p.voided_by_user_id, p.voided_at, p.void_reason
     FROM payments p
     WHERE p.order_id IN (SELECT DISTINCT order_id FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS')
     ORDER BY p.id`
  );
  console.log(`Fetched ${paymentResult.rows.length} payments`);

  fs.writeFileSync("/tmp/loyverse_ledger.json", JSON.stringify(ledgerResult.rows));
  fs.writeFileSync("/tmp/loyverse_payments.json", JSON.stringify(paymentResult.rows));

  console.log("Data exported to /tmp/loyverse_ledger.json and /tmp/loyverse_payments.json");

  client.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
