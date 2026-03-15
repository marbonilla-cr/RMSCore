--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."customers" (
  "id" serial PRIMARY KEY,
  "google_id" varchar(255) UNIQUE,
  "email" varchar(255) NOT NULL UNIQUE,
  "name" varchar(200) NOT NULL,
  "photo_url" text,
  "phone" varchar(30),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."loyalty_accounts" (
  "id" serial PRIMARY KEY,
  "customer_id" integer NOT NULL REFERENCES "public"."customers"("id"),
  "tenant_id" integer NOT NULL,
  "points_balance" numeric(12,2) NOT NULL DEFAULT 0,
  "lifetime_points" numeric(12,2) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE("customer_id", "tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."loyalty_events" (
  "id" serial PRIMARY KEY,
  "customer_id" integer NOT NULL REFERENCES "public"."customers"("id"),
  "tenant_id" integer NOT NULL,
  "event_type" varchar(20) NOT NULL,
  "points" numeric(12,2) NOT NULL,
  "amount_spent" numeric(12,2),
  "order_id" integer,
  "description" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."loyalty_config" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL UNIQUE,
  "is_active" boolean NOT NULL DEFAULT false,
  "earn_rate" numeric(5,2) NOT NULL DEFAULT 2.00,
  "min_redeem_points" numeric(12,2) NOT NULL DEFAULT 500,
  "redeem_rate" numeric(8,4) NOT NULL DEFAULT 1.0000,
  "points_expiry_days" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "operation_mode_table" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "operation_mode_qr" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "operation_mode_dispatch" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_accounts_customer_id_idx" ON "public"."loyalty_accounts"("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_accounts_tenant_id_idx" ON "public"."loyalty_accounts"("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_events_customer_id_idx" ON "public"."loyalty_events"("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_events_tenant_id_idx" ON "public"."loyalty_events"("tenant_id");
