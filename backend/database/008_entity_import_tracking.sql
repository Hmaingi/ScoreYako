-- Track when entity data was first created vs. most recently (re-)uploaded, so
-- users can tell apart last year's import from this year's for the same entity/org.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ;
UPDATE entities SET last_imported_at = created_at WHERE last_imported_at IS NULL;

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS last_import_at TIMESTAMPTZ;
UPDATE portfolios SET last_import_at = created_at WHERE last_import_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entities_last_imported_at ON entities (last_imported_at);
CREATE INDEX IF NOT EXISTS idx_portfolios_last_import_at ON portfolios (last_import_at);
