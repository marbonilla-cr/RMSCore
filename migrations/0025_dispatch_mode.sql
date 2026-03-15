--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_mode" varchar(20) NOT NULL DEFAULT 'TABLE';
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dispatch_status" varchar(30);
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "dispatch_order_timeout_minutes" integer NOT NULL DEFAULT 15;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_dispatch_status_idx" ON "orders"("dispatch_status") WHERE dispatch_status IS NOT NULL;
