--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "customer_name" text,
  "order_mode" varchar(20) NOT NULL DEFAULT 'TABLE',
  "business_date" varchar(10),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "review_points" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "review_email" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "business_config" ADD COLUMN IF NOT EXISTS "google_place_id" text NOT NULL DEFAULT '';
