ALTER TABLE entities
  ADD CONSTRAINT entities_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE portfolios
  ADD CONSTRAINT portfolios_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE financial_relationships
  ADD CONSTRAINT financial_relationships_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE collection_cases
  ADD CONSTRAINT collection_cases_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_id_organization_unique UNIQUE (id, organization_id);

ALTER TABLE promises_to_pay ADD COLUMN organization_id UUID;
UPDATE promises_to_pay ptp
SET organization_id = cc.organization_id
FROM collection_cases cc
WHERE cc.id = ptp.case_id AND ptp.organization_id IS NULL;
ALTER TABLE promises_to_pay ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE entity_raw_data ADD COLUMN organization_id UUID;
UPDATE entity_raw_data raw
SET organization_id = e.organization_id
FROM entities e
WHERE e.id = raw.entity_id AND raw.organization_id IS NULL;
ALTER TABLE entity_raw_data ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE entities
  ADD CONSTRAINT entities_portfolio_tenant_fkey
  FOREIGN KEY (portfolio_id, organization_id) REFERENCES portfolios (id, organization_id);
ALTER TABLE financial_relationships
  ADD CONSTRAINT financial_relationships_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE payments
  ADD CONSTRAINT payments_relationship_tenant_fkey
  FOREIGN KEY (financial_relationship_id, organization_id) REFERENCES financial_relationships (id, organization_id) ON DELETE CASCADE;
ALTER TABLE collection_cases
  ADD CONSTRAINT collection_cases_relationship_tenant_fkey
  FOREIGN KEY (financial_relationship_id, organization_id) REFERENCES financial_relationships (id, organization_id) ON DELETE CASCADE;
ALTER TABLE collection_cases
  ADD CONSTRAINT collection_cases_assignee_membership_fkey
  FOREIGN KEY (assigned_user_id, organization_id) REFERENCES organization_memberships (user_id, organization_id);
ALTER TABLE communications
  ADD CONSTRAINT communications_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE communications
  ADD CONSTRAINT communications_case_tenant_fkey
  FOREIGN KEY (case_id, organization_id) REFERENCES collection_cases (id, organization_id);
ALTER TABLE promises_to_pay
  ADD CONSTRAINT promises_case_tenant_fkey
  FOREIGN KEY (case_id, organization_id) REFERENCES collection_cases (id, organization_id) ON DELETE CASCADE;
ALTER TABLE promises_to_pay
  ADD CONSTRAINT promises_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_portfolio_tenant_fkey
  FOREIGN KEY (portfolio_id, organization_id) REFERENCES portfolios (id, organization_id) ON DELETE CASCADE;
ALTER TABLE import_job_sheet_mappings
  ADD CONSTRAINT import_sheet_mapping_job_tenant_fkey
  FOREIGN KEY (import_job_id, organization_id) REFERENCES import_jobs (id, organization_id) ON DELETE CASCADE;
ALTER TABLE entity_raw_data
  ADD CONSTRAINT entity_raw_data_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE kyc_profiles
  ADD CONSTRAINT kyc_profiles_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE kyc_entity_relationships
  ADD CONSTRAINT kyc_relationship_business_tenant_fkey
  FOREIGN KEY (business_entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE kyc_entity_relationships
  ADD CONSTRAINT kyc_relationship_related_tenant_fkey
  FOREIGN KEY (related_entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;
ALTER TABLE risk_snapshots
  ADD CONSTRAINT risk_snapshots_entity_tenant_fkey
  FOREIGN KEY (entity_id, organization_id) REFERENCES entities (id, organization_id) ON DELETE CASCADE;

CREATE INDEX idx_promises_to_pay_org_case ON promises_to_pay (organization_id, case_id);
CREATE INDEX idx_entity_raw_data_org_entity ON entity_raw_data (organization_id, entity_id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_organization_id_email_key;
DROP INDEX IF EXISTS idx_users_organization_id;
ALTER TABLE users DROP COLUMN IF EXISTS organization_id;
ALTER TABLE users DROP COLUMN IF EXISTS role;