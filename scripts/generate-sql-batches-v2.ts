import fs from "fs";

const ORDER_ID_OFFSET = 200;
const PROD_MAX_ORDER_ID = 121;
const PROD_MAX_PAYMENT_ID = 111;
const LEDGER_BATCH_SIZE = 500;
const PAYMENT_BATCH_SIZE = 1000;

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

fs.mkdirSync("/tmp/sql_v2", { recursive: true });

let ledgerBatchCount = 0;
for (let i = 0; i < ledgerRows.length; i += LEDGER_BATCH_SIZE) {
  const batch = ledgerRows.slice(i, i + LEDGER_BATCH_SIZE);
  const values = batch.map((r: any) => {
    return `(${r.id},${escapeStr(r.business_date)},${formatTs(r.created_at)},${formatNum(r.table_id)},${escapeStr(r.table_name_snapshot)},${r.order_id + offset},${formatNum(r.order_item_id)},${formatNum(r.product_id)},${escapeStr(r.product_code_snapshot)},${escapeStr(r.product_name_snapshot)},${formatNum(r.category_id)},${escapeStr(r.category_code_snapshot)},${escapeStr(r.category_name_snapshot)},${formatNum(r.qty)},${formatNum(r.unit_price)},${formatNum(r.line_subtotal)},${escapeStr(r.origin)},${formatNum(r.created_by_user_id)},${formatNum(r.responsible_waiter_id)},${escapeStr(r.status)},${formatTs(r.sent_to_kitchen_at)},${formatTs(r.kds_ready_at)},${formatTs(r.paid_at)})`;
  }).join(",");

  const sql = `INSERT INTO sales_ledger_items (id,business_date,created_at,table_id,table_name_snapshot,order_id,order_item_id,product_id,product_code_snapshot,product_name_snapshot,category_id,category_code_snapshot,category_name_snapshot,qty,unit_price,line_subtotal,origin,created_by_user_id,responsible_waiter_id,status,sent_to_kitchen_at,kds_ready_at,paid_at) VALUES ${values} ON CONFLICT (id) DO NOTHING;`;

  fs.writeFileSync(`/tmp/sql_v2/l_${String(ledgerBatchCount).padStart(3, "0")}.sql`, sql);
  ledgerBatchCount++;
}

let paymentBatchCount = 0;
for (let i = 0; i < paymentRows.length; i += PAYMENT_BATCH_SIZE) {
  const batch = paymentRows.slice(i, i + PAYMENT_BATCH_SIZE);
  const values = batch.map((r: any) => {
    const newId = r.id + PROD_MAX_PAYMENT_ID + 100;
    return `(${newId},${r.order_id + offset},${formatNum(r.split_id)},${formatNum(r.amount)},${formatNum(r.payment_method_id)},${formatTs(r.paid_at)},${formatNum(r.cashier_user_id)},${escapeStr(r.status)},${escapeStr(r.client_name_snapshot)},${escapeStr(r.client_email_snapshot)},${escapeStr(r.business_date)},${formatNum(r.voided_by_user_id)},${formatTs(r.voided_at)},${escapeStr(r.void_reason)})`;
  }).join(",");

  const sql = `INSERT INTO payments (id,order_id,split_id,amount,payment_method_id,paid_at,cashier_user_id,status,client_name_snapshot,client_email_snapshot,business_date,voided_by_user_id,voided_at,void_reason) VALUES ${values} ON CONFLICT (id) DO NOTHING;`;

  fs.writeFileSync(`/tmp/sql_v2/p_${String(paymentBatchCount).padStart(3, "0")}.sql`, sql);
  paymentBatchCount++;
}

console.log(`Generated ${ledgerBatchCount} ledger batches (${LEDGER_BATCH_SIZE}/batch) and ${paymentBatchCount} payment batches (${PAYMENT_BATCH_SIZE}/batch)`);
console.log(`Total: ${ledgerBatchCount + paymentBatchCount} files`);

const sizes = fs.readdirSync("/tmp/sql_v2").map(f => ({
  file: f,
  size: fs.statSync(`/tmp/sql_v2/${f}`).size
}));
const maxSize = Math.max(...sizes.map(s => s.size));
const avgSize = sizes.reduce((sum, s) => sum + s.size, 0) / sizes.length;
console.log(`Max file size: ${(maxSize/1024).toFixed(1)}KB, Avg: ${(avgSize/1024).toFixed(1)}KB`);
