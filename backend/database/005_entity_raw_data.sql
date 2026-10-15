-- Table to store all raw Excel data for entities
CREATE TABLE IF NOT EXISTS entity_raw_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL,
    sheet_name VARCHAR(255),
    raw_data JSONB NOT NULL,
    source_row_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_entity_raw_data_entity_id ON entity_raw_data (entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_raw_data_import_job_id ON entity_raw_data (import_job_id);
