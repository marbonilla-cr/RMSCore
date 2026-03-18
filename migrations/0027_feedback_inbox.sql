--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_messages" (
  "id" serial PRIMARY KEY,
  "order_id" integer REFERENCES "orders"("id"),
  "rating" integer NOT NULL,
  "comment" text,
  "customer_name" varchar(200),
  "is_read" boolean NOT NULL DEFAULT false,
  "business_date" date NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_messages_is_read_idx" 
  ON "feedback_messages"("is_read");
--> statement-breakpoint
ALTER TABLE "business_config" 
  ADD COLUMN IF NOT EXISTS "google_maps_review_url" text;
