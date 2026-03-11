ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamp;

--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'tenants'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN IF NOT EXISTS trial_base_plan varchar(20);
  END IF;
END $$;
