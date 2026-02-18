import fs from "fs";

const batchDir = "/tmp/sql_batches";
const mergedDir = "/tmp/sql_merged";
fs.mkdirSync(mergedDir, { recursive: true });

const ledgerFiles = fs.readdirSync(batchDir).filter(f => f.startsWith("ledger_")).sort();
const paymentFiles = fs.readdirSync(batchDir).filter(f => f.startsWith("payment_")).sort();

const MERGE_COUNT = 10;

function mergeFiles(files: string[], prefix: string) {
  let mergedIdx = 0;
  for (let i = 0; i < files.length; i += MERGE_COUNT) {
    const batch = files.slice(i, i + MERGE_COUNT);
    const merged = batch.map(f => fs.readFileSync(`${batchDir}/${f}`, "utf-8")).join("\n");
    fs.writeFileSync(`${mergedDir}/${prefix}_${String(mergedIdx).padStart(3, "0")}.sql`, merged);
    mergedIdx++;
  }
  return mergedIdx;
}

const ledgerCount = mergeFiles(ledgerFiles, "ledger");
const paymentCount = mergeFiles(paymentFiles, "payment");

console.log(`Merged into ${ledgerCount} ledger files and ${paymentCount} payment files`);
console.log(`Total: ${ledgerCount + paymentCount} files (~2000 rows per ledger file, ~2000 rows per payment file)`);
