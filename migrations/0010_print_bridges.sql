--> statement-breakpoint
CREATE TABLE IF NOT EXISTS print_bridges (
  id           SERIAL PRIMARY KEY,
  bridge_id    VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  token        VARCHAR(255) NOT NULL UNIQUE,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

--> statement-breakpoint
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS bridge_id VARCHAR(100);

--> statement-breakpoint
INSERT INTO print_bridges (bridge_id, display_name, token, is_active)
SELECT 'bridge-001', 'Bridge Principal', 'bridge-token-local', true
WHERE NOT EXISTS (
  SELECT 1 FROM print_bridges WHERE bridge_id = 'bridge-001'
);
