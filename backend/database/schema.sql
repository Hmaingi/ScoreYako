CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'MANAGER', 'USER', 'COLLECTIONS')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, email)
);

CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'BUSINESS')),
    legal_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, tax_id)
);

CREATE TABLE financial_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type VARCHAR(40) NOT NULL CHECK (relationship_type IN ('INVOICE', 'LOAN', 'TRADE_CREDIT')),
    original_amount NUMERIC(18,2) NOT NULL CHECK (original_amount >= 0),
    outstanding_amount NUMERIC(18,2) NOT NULL CHECK (outstanding_amount >= 0),
    currency CHAR(3) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'CLOSED')),
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    financial_relationship_id UUID NOT NULL REFERENCES financial_relationships(id) ON DELETE CASCADE,
    amount_paid NUMERIC(18,2) NOT NULL CHECK (amount_paid > 0),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method VARCHAR(40) NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'WIRE', 'OTHER')),
    reference_no VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    financial_relationship_id UUID NOT NULL REFERENCES financial_relationships(id) ON DELETE CASCADE,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIVE', 'ESCALATED', 'RESOLVED', 'CLOSED')),
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    stage VARCHAR(30) NOT NULL DEFAULT 'INITIAL_CONTACT' CHECK (stage IN ('INITIAL_CONTACT', 'PROMISE_TO_PAY', 'NEGOTIATION', 'LEGAL', 'COLLECTION', 'RESOLVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE promises_to_pay (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    promised_amount NUMERIC(18,2) NOT NULL CHECK (promised_amount > 0),
    promised_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'BROKEN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE communications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    case_id UUID REFERENCES collection_cases(id) ON DELETE SET NULL,
    comm_type VARCHAR(20) NOT NULL CHECK (comm_type IN ('CALL', 'SMS', 'EMAIL', 'WHATSAPP')),
    notes TEXT,
    outcome VARCHAR(255),
    next_action_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_organization_id ON users (organization_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_entities_organization_id ON entities (organization_id);
CREATE INDEX idx_entities_entity_type ON entities (entity_type);
CREATE INDEX idx_entities_legal_name ON entities (legal_name);
CREATE INDEX idx_financial_relationships_org_id ON financial_relationships (organization_id);
CREATE INDEX idx_financial_relationships_entity_id ON financial_relationships (entity_id);
CREATE INDEX idx_financial_relationships_status ON financial_relationships (status);
CREATE INDEX idx_financial_relationships_due_date ON financial_relationships (due_date);
CREATE INDEX idx_payments_organization_id ON payments (organization_id);
CREATE INDEX idx_payments_financial_relationship_id ON payments (financial_relationship_id);
CREATE INDEX idx_payments_payment_date ON payments (payment_date);
CREATE INDEX idx_collection_cases_org_id ON collection_cases (organization_id);
CREATE INDEX idx_collection_cases_relationship_id ON collection_cases (financial_relationship_id);
CREATE INDEX idx_collection_cases_status ON collection_cases (status);
CREATE INDEX idx_collection_cases_priority ON collection_cases (priority);
CREATE INDEX idx_collection_cases_assigned_user_id ON collection_cases (assigned_user_id);
CREATE INDEX idx_promises_to_pay_case_id ON promises_to_pay (case_id);
CREATE INDEX idx_promises_to_pay_entity_id ON promises_to_pay (entity_id);
CREATE INDEX idx_promises_to_pay_status ON promises_to_pay (status);
CREATE INDEX idx_promises_to_pay_promised_date ON promises_to_pay (promised_date);
CREATE INDEX idx_communications_organization_id ON communications (organization_id);
CREATE INDEX idx_communications_entity_id ON communications (entity_id);
CREATE INDEX idx_communications_case_id ON communications (case_id);
CREATE INDEX idx_communications_comm_type ON communications (comm_type);
CREATE INDEX idx_communications_next_action_date ON communications (next_action_date);

-- Tracks first creation vs most recent (re-)upload date per entity/portfolio so users can
-- distinguish, e.g., last year's import from this year's for the same entity.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_entities_last_imported_at ON entities (last_imported_at);
