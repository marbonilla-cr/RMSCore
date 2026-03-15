--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "transaction_code" varchar(3);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_transaction_code_business_date_idx"
  ON "orders"("transaction_code", "business_date") WHERE "transaction_code" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."customers" ADD COLUMN IF NOT EXISTS "daily_visit_code" varchar(10);
