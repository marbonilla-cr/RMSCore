import pg from "pg";

const DEV_DB_URL = process.env.DATABASE_URL!;
const PROD_DB_URL = process.env.PROD_DATABASE_URL!;

if (!DEV_DB_URL || !PROD_DB_URL) {
  console.error("ERROR: DATABASE_URL and PROD_DATABASE_URL must be set");
  process.exit(1);
}

const BATCH_SIZE = 500;
const ORDER_ID_OFFSET = 200;

async function main() {
  const devPool = new pg.Pool({ connectionString: DEV_DB_URL, ssl: { rejectUnauthorized: false } });
  const prodPool = new pg.Pool({ connectionString: PROD_DB_URL, ssl: { rejectUnauthorized: false } });

  try {
    console.log("Connecting to databases...");
    const devClient = await devPool.connect();
    const prodClient = await prodPool.connect();

    const safetyCheck = await prodClient.query(
      "SELECT COUNT(*) as cnt FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS'"
    );
    if (parseInt(safetyCheck.rows[0].cnt) > 0) {
      console.error("ABORT: Production already has LOYVERSE_POS records. Migration already done.");
      devClient.release();
      prodClient.release();
      return;
    }

    const prodMaxOrderId = await prodClient.query("SELECT COALESCE(MAX(order_id), 0) as max_oid FROM sales_ledger_items");
    const prodMaxLedgerId = await prodClient.query("SELECT COALESCE(MAX(id), 0) as max_id FROM sales_ledger_items");
    const prodMaxPaymentId = await prodClient.query("SELECT COALESCE(MAX(id), 0) as max_id FROM payments");
    console.log(`Production max IDs: ledger=${prodMaxLedgerId.rows[0].max_id}, payment=${prodMaxPaymentId.rows[0].max_id}, order=${prodMaxOrderId.rows[0].max_oid}`);

    console.log("\n--- Fetching LOYVERSE_POS ledger items from dev ---");
    const ledgerResult = await devClient.query(
      `SELECT id, business_date, created_at, table_id, table_name_snapshot, order_id, order_item_id,
              product_id, product_code_snapshot, product_name_snapshot, category_id, category_code_snapshot,
              category_name_snapshot, qty, unit_price, line_subtotal, origin, created_by_user_id,
              responsible_waiter_id, status, sent_to_kitchen_at, kds_ready_at, paid_at
       FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS' ORDER BY id`
    );
    console.log(`Fetched ${ledgerResult.rows.length} ledger items`);

    console.log("\n--- Fetching linked payments from dev ---");
    const paymentResult = await devClient.query(
      `SELECT p.id, p.order_id, p.split_id, p.amount, p.payment_method_id, p.paid_at,
              p.cashier_user_id, p.status, p.client_name_snapshot, p.client_email_snapshot,
              p.business_date, p.voided_by_user_id, p.voided_at, p.void_reason
       FROM payments p
       WHERE p.order_id IN (SELECT DISTINCT order_id FROM sales_ledger_items WHERE origin = 'LOYVERSE_POS')
       ORDER BY p.id`
    );
    console.log(`Fetched ${paymentResult.rows.length} payments`);

    const maxProdOid = parseInt(prodMaxOrderId.rows[0].max_oid);
    const offset = maxProdOid + ORDER_ID_OFFSET;
    console.log(`\nOrder ID offset: ${offset} (prod max ${maxProdOid} + ${ORDER_ID_OFFSET} buffer)`);

    console.log("\n--- Inserting ledger items into production ---");
    await prodClient.query("BEGIN");

    try {
      let insertedLedger = 0;
      for (let i = 0; i < ledgerResult.rows.length; i += BATCH_SIZE) {
        const batch = ledgerResult.rows.slice(i, i + BATCH_SIZE);
        const values: any[] = [];
        const placeholders: string[] = [];

        batch.forEach((row, idx) => {
          const base = idx * 23;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23})`
          );
          values.push(
            row.id,
            row.business_date,
            row.created_at,
            row.table_id,
            row.table_name_snapshot,
            row.order_id + offset,
            row.order_item_id,
            row.product_id,
            row.product_code_snapshot,
            row.product_name_snapshot,
            row.category_id,
            row.category_code_snapshot,
            row.category_name_snapshot,
            row.qty,
            row.unit_price,
            row.line_subtotal,
            row.origin,
            row.created_by_user_id,
            row.responsible_waiter_id,
            row.status,
            row.sent_to_kitchen_at,
            row.kds_ready_at,
            row.paid_at
          );
        });

        await prodClient.query(
          `INSERT INTO sales_ledger_items (id, business_date, created_at, table_id, table_name_snapshot, order_id, order_item_id,
            product_id, product_code_snapshot, product_name_snapshot, category_id, category_code_snapshot,
            category_name_snapshot, qty, unit_price, line_subtotal, origin, created_by_user_id,
            responsible_waiter_id, status, sent_to_kitchen_at, kds_ready_at, paid_at)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (id) DO NOTHING`,
          values
        );

        insertedLedger += batch.length;
        if (insertedLedger % 5000 === 0 || insertedLedger === ledgerResult.rows.length) {
          console.log(`  Ledger progress: ${insertedLedger}/${ledgerResult.rows.length}`);
        }
      }

      console.log("\n--- Inserting payments into production ---");
      let insertedPayments = 0;
      const maxProdPayId = parseInt(prodMaxPaymentId.rows[0].max_id);

      for (let i = 0; i < paymentResult.rows.length; i += BATCH_SIZE) {
        const batch = paymentResult.rows.slice(i, i + BATCH_SIZE);
        const values: any[] = [];
        const placeholders: string[] = [];

        batch.forEach((row, idx) => {
          const base = idx * 14;
          const newPaymentId = row.id + maxProdPayId + 100;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`
          );
          values.push(
            newPaymentId,
            row.order_id + offset,
            row.split_id,
            row.amount,
            row.payment_method_id,
            row.paid_at,
            row.cashier_user_id,
            row.status,
            row.client_name_snapshot,
            row.client_email_snapshot,
            row.business_date,
            row.voided_by_user_id,
            row.voided_at,
            row.void_reason
          );
        });

        await prodClient.query(
          `INSERT INTO payments (id, order_id, split_id, amount, payment_method_id, paid_at,
            cashier_user_id, status, client_name_snapshot, client_email_snapshot,
            business_date, voided_by_user_id, voided_at, void_reason)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (id) DO NOTHING`,
          values
        );

        insertedPayments += batch.length;
        if (insertedPayments % 5000 === 0 || insertedPayments === paymentResult.rows.length) {
          console.log(`  Payment progress: ${insertedPayments}/${paymentResult.rows.length}`);
        }
      }

      const updateLedgerSeq = await prodClient.query(
        "SELECT setval(pg_get_serial_sequence('sales_ledger_items', 'id'), (SELECT MAX(id) FROM sales_ledger_items))"
      );
      const updatePaymentSeq = await prodClient.query(
        "SELECT setval(pg_get_serial_sequence('payments', 'id'), (SELECT MAX(id) FROM payments))"
      );
      console.log(`\nUpdated sequences: ledger=${updateLedgerSeq.rows[0].setval}, payment=${updatePaymentSeq.rows[0].setval}`);

      await prodClient.query("COMMIT");
      console.log("\n=== MIGRATION COMMITTED SUCCESSFULLY ===");
      console.log(`Inserted ${insertedLedger} ledger items and ${insertedPayments} payments`);

    } catch (err) {
      await prodClient.query("ROLLBACK");
      console.error("ROLLBACK - Error during migration:", err);
      throw err;
    }

    devClient.release();
    prodClient.release();

  } finally {
    await devPool.end();
    await prodPool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
