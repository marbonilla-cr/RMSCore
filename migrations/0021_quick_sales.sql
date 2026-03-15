--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "table_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "is_quick_sale" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "quick_sale_name" varchar(100);
