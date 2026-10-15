-- Add portfolios/sources concept for multi-tenant data ingestion
CREATE TABLE IF NOT EXISTS portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('EXCEL', 'API', 'MANUAL', 'CSV', 'BATCH_UPLOAD')),
    import_template JSONB,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

-- Create import jobs for staging preview/commit workflow
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'STAGING', 'PREVIEW', 'READY', 'COMMITTED', 'FAILED')),
    file_name VARCHAR(255) NOT NULL,
    file_buffer BYTEA NOT NULL,
    parsed_data JSONB NOT NULL DEFAULT '{}',
    field_mappings JSONB NOT NULL DEFAULT '{}',
    validation_result JSONB NOT NULL DEFAULT '{}',
    created_entities INTEGER DEFAULT 0,
    created_relationships INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at TIMESTAMPTZ
);

-- Add extra_data to entities for source-specific attributes
ALTER TABLE entities ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL;

-- Add extra_data to financial_relationships
ALTER TABLE financial_relationships ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_portfolios_organization_id ON portfolios (organization_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_organization_id ON import_jobs (organization_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_portfolio_id ON import_jobs (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs (status);
CREATE INDEX IF NOT EXISTS idx_entities_portfolio_id ON entities (portfolio_id);
