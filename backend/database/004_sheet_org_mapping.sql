-- Add table to track sheet-to-organization mappings
CREATE TABLE IF NOT EXISTS import_job_sheet_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    sheet_name VARCHAR(255) NOT NULL,
    group_name VARCHAR(255) NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL DEFAULT 'SHEET',
    row_count INTEGER,
    field_mappings JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_import_job_sheet_mappings_job_id ON import_job_sheet_mappings (import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_sheet_mappings_org_id ON import_job_sheet_mappings (organization_id);
CREATE INDEX IF NOT EXISTS idx_import_job_sheet_mappings_group_name ON import_job_sheet_mappings (group_name);

-- Add group_assignments to import_jobs to store the mapping structure
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS group_assignments JSONB DEFAULT '{}';
