ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "order_daily_start" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "order_global_start" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "invoice_start" integer DEFAULT 1 NOT NULL;