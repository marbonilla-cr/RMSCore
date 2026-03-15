--> statement-breakpoint
INSERT INTO "payment_methods" ("payment_name", "payment_code", "active")
VALUES ('Cargo a Empleado', 'EMPLOYEE_CHARGE', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_charges" (
  "id" serial PRIMARY KEY,
  "employee_id" integer NOT NULL REFERENCES "users"("id"),
  "order_id" integer NOT NULL REFERENCES "orders"("id"),
  "payment_id" integer REFERENCES "payments"("id"),
  "amount" numeric(12,2) NOT NULL,
  "description" text,
  "business_date" date NOT NULL,
  "is_settled" boolean NOT NULL DEFAULT false,
  "settled_at" timestamp,
  "settled_by" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" integer REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_charges_employee_id_idx" ON "employee_charges"("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_charges_is_settled_idx" ON "employee_charges"("is_settled");
