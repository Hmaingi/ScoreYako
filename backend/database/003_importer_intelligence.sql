-- Support account-level linkage and generic obligation types discovered during import
-- (avoids inventing a specific relationship_type like LOAN when the source data does not say so).
ALTER TABLE financial_relationships DROP CONSTRAINT IF EXISTS financial_relationships_relationship_type_check;
ALTER TABLE financial_relationships
  ADD CONSTRAINT financial_relationships_relationship_type_check
  CHECK (relationship_type IN ('INVOICE', 'LOAN', 'TRADE_CREDIT', 'ACCOUNT'));

ALTER TABLE financial_relationships ADD COLUMN IF NOT EXISTS account_number VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_financial_relationships_account_number ON financial_relationships (account_number);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS account_number VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_payments_account_number ON payments (account_number);
