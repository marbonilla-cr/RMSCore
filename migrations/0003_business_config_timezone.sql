-- 0003_business_config_timezone.sql
-- Adds configurable timezone per tenant to business_config.
-- Default: America/Costa_Rica (preserves existing behavior for all current tenants).
-- This supports multi-tenant deployments across different time zones.

ALTER TABLE business_config ADD COLUMN IF NOT EXISTS timezone varchar(100) NOT NULL DEFAULT 'America/Costa_Rica';
