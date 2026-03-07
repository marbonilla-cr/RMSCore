ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamp;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_base_plan varchar(20);
