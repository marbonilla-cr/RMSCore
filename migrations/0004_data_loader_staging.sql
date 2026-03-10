CREATE TABLE IF NOT EXISTS data_loader_sessions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded',
  file_name TEXT,
  sheets_found TEXT[],
  error_message TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_loader_staging (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES data_loader_sessions(id) ON DELETE CASCADE,
  tenant_id INTEGER,
  sheet_name TEXT NOT NULL,
  row_index INTEGER,
  data_json JSONB,
  validation_status TEXT DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING', 'VALID', 'INVALID')),
  validation_errors JSONB,
  imported BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_loader_staging_session ON data_loader_staging(session_id);
CREATE INDEX IF NOT EXISTS idx_data_loader_staging_session_sheet ON data_loader_staging(session_id, sheet_name);
