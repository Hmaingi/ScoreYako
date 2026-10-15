ALTER TABLE kyc_entity_relationships
  DROP CONSTRAINT IF EXISTS kyc_entity_relationships_relationship_type_check;

ALTER TABLE kyc_entity_relationships
  ADD CONSTRAINT kyc_entity_relationships_relationship_type_check
  CHECK (relationship_type IN (
    'DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER',
    'AUTHORIZED_REPRESENTATIVE', 'CONTACT_PERSON',
    'CLIENT', 'CUSTOMER', 'SUPPLIER', 'PARENT_COMPANY',
    'SUBSIDIARY', 'BUSINESS_PARTNER'
  ));

CREATE INDEX IF NOT EXISTS idx_kyc_relationships_business_type
  ON kyc_entity_relationships (organization_id, business_entity_id, relationship_type);