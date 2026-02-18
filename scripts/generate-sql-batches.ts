import fs from "fs";

const ORDER_ID_OFFSET = 200;
const PROD_MAX_ORDER_ID = 121;
const PROD_MAX_PAYMENT_ID = 111;
const BATCH_SIZE = 200;

const offset = PROD_MAX_ORDER_ID + ORDER_ID_OFFSET;

function escapeStr(val: any): string {
  if (val === null || val === undefined) return "NULL";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

function formatTs(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (val instanceof Date) {
    return `'${val.toISOString().replace("T", " ").replace("Z", "")}'`;
  }
  return escapeStr(val);
}

function formatNum(val: any): string {
  if (val === null || val === undefined) return "NULL";
  return String(val);
}

const ledgerRows = JSON.parse(fs.readFileSync("/tmp/loyverse_ledger.json", "utf-8"));
const paymentRows = JSON.parse(fs.readFileSync("/tmp/loyverse_payments.json", "utf-8"));

console.log(`Generating SQL for ${ledgerRows.length} ledger items and ${paymentRows.length} payments`);
console.log(`Order ID offset: +${offset}`);

const ledgerBatches: string[] = [];
for (let i = 0; i < ledgerRows.length; i += BATCH_SIZE) {
  const batch = ledgerRows.slice(i, i + BATCH_SIZE);
  const values = batch.map((r: any) => {
    return `(${r.id}, ${escapeStr(r.business_date)}, ${formatTs(r.created_at)}, ${formatNum(r.table_id)}, ${escapeStr(r.table_name_snapshot)}, ${r.order_id + offset}, ${formatNum(r.order_item_id)}, ${formatNum(r.product_id)}, ${escapeStr(r.product_code_snapshot)}, ${escapeStr(r.product_name_snapshot)}, ${formatNum(r.category_id)}, ${escapeStr(r.category_code_snapshot)}, ${escapeStr(r.category_name_snapshot)}, ${formatNum(r.qty)}, ${formatNum(r.unit_price)}, ${formatNum(r.line_subtotal)}, ${escapeStr(r.origin)}, ${formatNum(r.created_by_user_id)}, ${formatNum(r.responsible_waiter_id)}, ${escapeStr(r.status)}, ${formatTs(r.sent_to_kitchen_at)}, ${formatTs(r.kds_ready_at)}, ${formatTs(r.paid_at)})`;
  }).join(",\n");

  const sql = `INSERT INTO sales_ledger_items (id, business_date, created_at, table_id, table_name_snapshot, order_id, order_item_id, product_id, product_code_snapshot, product_name_snapshot, category_id, category_code_snapshot, category_name_snapshot, qty, unit_price, line_subtotal, origin, created_by_user_id, responsible_waiter_id, status, sent_to_kitchen_at, kds_ready_at, paid_at) VALUES\n${values}\nON CONFLICT (id) DO NOTHING;`;

  ledgerBatches.push(sql);
}

const paymentBatches: string[] = [];
for (let i = 0; i < paymentRows.length; i += BATCH_SIZE) {
  const batch = paymentRows.slice(i, i + BATCH_SIZE);
  const values = batch.map((r: any) => {
    const newId = r.id + PROD_MAX_PAYMENT_ID + 100;
    return `(${newId}, ${r.order_id + offset}, ${formatNum(r.split_id)}, ${formatNum(r.amount)}, ${formatNum(r.payment_method_id)}, ${formatTs(r.paid_at)}, ${formatNum(r.cashier_user_id)}, ${escapeStr(r.status)}, ${escapeStr(r.client_name_snapshot)}, ${escapeStr(r.client_email_snapshot)}, ${escapeStr(r.business_date)}, ${formatNum(r.voided_by_user_id)}, ${formatTs(r.voided_at)}, ${escapeStr(r.void_reason)})`;
  }).join(",\n");

  const sql = `INSERT INTO payments (id, order_id, split_id, amount, payment_method_id, paid_at, cashier_user_id, status, client_name_snapshot, client_email_snapshot, business_date, voided_by_user_id, voided_at, void_reason) VALUES\n${values}\nON CONFLICT (id) DO NOTHING;`;

  paymentBatches.push(sql);
}

fs.mkdirSync("/tmp/sql_batches", { recursive: true });

ledgerBatches.forEach((sql, i) => {
  fs.writeFileSync(`/tmp/sql_batches/ledger_${String(i).padStart(4, "0")}.sql`, sql);
});

paymentBatches.forEach((sql, i) => {
  fs.writeFileSync(`/tmp/sql_batches/payment_${String(i).padStart(4, "0")}.sql`, sql);
});

console.log(`Generated ${ledgerBatches.length} ledger batch files and ${paymentBatches.length} payment batch files`);
console.log(`Files in /tmp/sql_batches/`);
