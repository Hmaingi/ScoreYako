DO $$
BEGIN
  IF to_regclass('public.financial_relationships') IS NOT NULL THEN
    ALTER TABLE financial_relationships DROP CONSTRAINT IF EXISTS financial_relationships_entity_id_fkey;
    ALTER TABLE financial_relationships
      ADD CONSTRAINT financial_relationships_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.promises_to_pay') IS NOT NULL THEN
    ALTER TABLE promises_to_pay DROP CONSTRAINT IF EXISTS promises_to_pay_entity_id_fkey;
    ALTER TABLE promises_to_pay
      ADD CONSTRAINT promises_to_pay_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.communications') IS NOT NULL THEN
    ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_entity_id_fkey;
    ALTER TABLE communications
      ADD CONSTRAINT communications_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.entity_raw_data') IS NOT NULL THEN
    ALTER TABLE entity_raw_data DROP CONSTRAINT IF EXISTS entity_raw_data_entity_id_fkey;
    ALTER TABLE entity_raw_data
      ADD CONSTRAINT entity_raw_data_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.kyc_profiles') IS NOT NULL THEN
    ALTER TABLE kyc_profiles DROP CONSTRAINT IF EXISTS kyc_profiles_entity_id_fkey;
    ALTER TABLE kyc_profiles
      ADD CONSTRAINT kyc_profiles_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.kyc_entity_relationships') IS NOT NULL THEN
    ALTER TABLE kyc_entity_relationships DROP CONSTRAINT IF EXISTS kyc_entity_relationships_business_entity_id_fkey;
    ALTER TABLE kyc_entity_relationships
      ADD CONSTRAINT kyc_entity_relationships_business_entity_id_fkey
      FOREIGN KEY (business_entity_id) REFERENCES entities(id) ON DELETE CASCADE;

    ALTER TABLE kyc_entity_relationships DROP CONSTRAINT IF EXISTS kyc_entity_relationships_related_entity_id_fkey;
    ALTER TABLE kyc_entity_relationships
      ADD CONSTRAINT kyc_entity_relationships_related_entity_id_fkey
      FOREIGN KEY (related_entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.risk_snapshots') IS NOT NULL THEN
    ALTER TABLE risk_snapshots DROP CONSTRAINT IF EXISTS risk_snapshots_entity_id_fkey;
    ALTER TABLE risk_snapshots
      ADD CONSTRAINT risk_snapshots_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
  END IF;
END $$;
