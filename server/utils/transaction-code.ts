import { eq, and, sql } from "drizzle-orm";
import { orders } from "@shared/schema";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O,0,I,1 para evitar confusión

export async function generateTransactionCode(
  db: any,
  businessDate: string
): Promise<string> {
  const usedCodes = await db
    .select({ code: orders.transactionCode })
    .from(orders)
    .where(
      and(
        eq(orders.businessDate, businessDate),
        sql`${orders.transactionCode} IS NOT NULL`
      )
    );

  const used = new Set(usedCodes.map((r: any) => r.code));

  let attempts = 0;
  while (attempts < 1000) {
    const code =
      CHARS[Math.floor(Math.random() * CHARS.length)] +
      CHARS[Math.floor(Math.random() * CHARS.length)] +
      CHARS[Math.floor(Math.random() * CHARS.length)];
    if (!used.has(code)) return code;
    attempts++;
  }
  return Date.now().toString(36).slice(-3).toUpperCase();
}
