--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "force_password_change" boolean NOT NULL DEFAULT false;
