-- Source systems can legitimately represent credits and overpayments as signed
-- balances. Import preserves those source values, so financial relationships must
-- not reject them at persistence time.
ALTER TABLE financial_relationships
  DROP CONSTRAINT IF EXISTS financial_relationships_original_amount_check;
ALTER TABLE financial_relationships
  DROP CONSTRAINT IF EXISTS financial_relationships_outstanding_amount_check;
