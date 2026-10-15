CREATE TABLE IF NOT EXISTS kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    kyc_type VARCHAR(20) NOT NULL CHECK (kyc_type IN ('INDIVIDUAL', 'BUSINESS')),
    status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    risk_level VARCHAR(20) CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    verification_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')),
    verification_method VARCHAR(80),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, entity_id),
    UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS kyc_individuals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    kyc_profile_id UUID NOT NULL UNIQUE,
    first_name VARCHAR(120), middle_name VARCHAR(120), last_name VARCHAR(120),
    date_of_birth DATE, gender VARCHAR(50), nationality VARCHAR(100),
    national_id VARCHAR(100), passport_number VARCHAR(100), tax_pin VARCHAR(100),
    other_id_type VARCHAR(80), other_id_number VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    kyc_profile_id UUID NOT NULL UNIQUE,
    legal_name VARCHAR(255), trading_name VARCHAR(255), registration_number VARCHAR(100),
    tax_pin VARCHAR(100), business_type VARCHAR(100), incorporation_date DATE,
    country_of_incorporation VARCHAR(100), registration_country VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    kyc_profile_id UUID NOT NULL,
    address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('RESIDENTIAL', 'REGISTERED', 'BUSINESS', 'POSTAL', 'OTHER')),
    country VARCHAR(100), county VARCHAR(100), city VARCHAR(100), physical_address TEXT, postal_address TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kyc_profile_id UUID NOT NULL, document_type VARCHAR(40) NOT NULL, document_number VARCHAR(100),
    file_reference TEXT, document_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (document_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    issued_by VARCHAR(255), issued_at DATE, expires_at DATE, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ, verified_by UUID REFERENCES users(id) ON DELETE SET NULL, rejection_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kyc_profile_id UUID NOT NULL, status VARCHAR(30) NOT NULL, method VARCHAR(80), performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reason TEXT, notes TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kyc_profile_id UUID NOT NULL, check_type VARCHAR(40) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'NOT_RUN' CHECK (status IN ('NOT_RUN', 'PENDING', 'PASSED', 'FAILED', 'REVIEW')),
    result TEXT, performed_at TIMESTAMPTZ, performed_by UUID REFERENCES users(id) ON DELETE SET NULL, provider VARCHAR(100), reference VARCHAR(255),
    notes TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (kyc_profile_id, organization_id) REFERENCES kyc_profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kyc_entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    business_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    related_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) NOT NULL CHECK (relationship_type IN ('DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER', 'AUTHORIZED_REPRESENTATIVE', 'CONTACT_PERSON')),
    ownership_percentage NUMERIC(5,2) CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, business_entity_id, related_entity_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_kyc_profiles_org_status ON kyc_profiles (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_kyc_profiles_entity ON kyc_profiles (entity_id);
CREATE INDEX IF NOT EXISTS idx_kyc_addresses_profile ON kyc_addresses (kyc_profile_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_profile ON kyc_documents (kyc_profile_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_profile ON kyc_verifications (kyc_profile_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_profile ON kyc_checks (kyc_profile_id);
CREATE INDEX IF NOT EXISTS idx_kyc_relationships_business ON kyc_entity_relationships (business_entity_id);
CREATE INDEX IF NOT EXISTS idx_kyc_relationships_related ON kyc_entity_relationships (related_entity_id);
