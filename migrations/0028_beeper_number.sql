--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "beeper_number" varchar(20);
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "use_beeper_system" boolean NOT NULL DEFAULT false;
