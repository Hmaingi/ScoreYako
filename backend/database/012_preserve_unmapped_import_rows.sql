CREATE TABLE IF NOT EXISTS import_job_raw_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    import_job_id UUID NOT NULL,
    sheet_name VARCHAR(255) NOT NULL,
    source_row_number INTEGER NOT NULL,
    reason TEXT NOT NULL,
    raw_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT import_job_raw_rows_job_tenant_fkey
      FOREIGN KEY (import_job_id, organization_id)
      REFERENCES import_jobs (id, organization_id) ON DELETE CASCADE,
    CONSTRAINT import_job_raw_rows_source_unique
      UNIQUE (import_job_id, sheet_name, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_job_raw_rows_tenant_job
  ON import_job_raw_rows (organization_id, import_job_id, sheet_name, source_row_number);