-- Railway Data Sync
-- Session: 2026-03-07
-- Syncs employee passwords, emails, and HR permissions for STAFF/KITCHEN roles

BEGIN;

-- 1. Set password (Laantigua2004!) and email for all 10 employees
UPDATE users SET
  password = '$2b$10$OUvDGCnyID5b8te1yGb1h.eWaz5oBuWJXGSb.Hni0i24N/eNfN31O',
  email = CASE username
    WHEN 'alexa' THEN 'alexa@laantigualecheria.com'
    WHEN 'carmenrivera' THEN 'carmenrivera@laantigualecheria.com'
    WHEN 'deniseguevara' THEN 'deniseguevara@laantigualecheria.com'
    WHEN 'johnytenorio' THEN 'johnytenorio@laantigualecheria.com'
    WHEN 'luisrivera' THEN 'luisrivera@laantigualecheria.com'
    WHEN 'gerente' THEN 'gerente@laantigualecheria.com'
    WHEN 'marbonilla' THEN 'marbonilla@laantigualecheria.com'
    WHEN 'lorenza' THEN 'lorenza@laantigualecheria.com'
    WHEN 'mrivera' THEN 'mrivera@laantigualecheria.com'
    WHEN 'cajero' THEN 'cajero@laantigualecheria.com'
  END
WHERE username IN ('alexa','carmenrivera','deniseguevara','johnytenorio','luisrivera','gerente','marbonilla','lorenza','mrivera','cajero');

-- 2. Grant HR permissions to STAFF and KITCHEN roles
INSERT INTO role_permissions (role, permission_key)
SELECT v.role, v.permission_key FROM (VALUES
  ('STAFF', 'MODULE_HR_VIEW'),
  ('STAFF', 'HR_VIEW_SELF'),
  ('STAFF', 'HR_CLOCK_IN_OUT_ALLOW'),
  ('KITCHEN', 'MODULE_HR_VIEW'),
  ('KITCHEN', 'HR_VIEW_SELF'),
  ('KITCHEN', 'HR_CLOCK_IN_OUT_ALLOW')
) AS v(role, permission_key)
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role = v.role AND rp.permission_key = v.permission_key
);

COMMIT;
