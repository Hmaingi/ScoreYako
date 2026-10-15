CREATE TABLE IF NOT EXISTS organization_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'USER', 'COLLECTIONS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organization_id)
);
INSERT INTO organization_memberships (user_id, organization_id, role)
SELECT id, organization_id, role FROM users ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(100) NOT NULL, resource_type VARCHAR(100) NOT NULL,
  resource_id UUID, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events (organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS risk_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE, risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  rationale JSONB NOT NULL, calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_entity_calculated ON risk_snapshots (entity_id, calculated_at DESC);
UPDATE users SET password_hash = 'scrypt$cbc37ac7e8bef52027550c6093a1fe51$b0abdbd9d53b24ded56b27fc38af6bada443e4934425c9d94a1cff1a1722ace3f4b4bf80eac0f0b51f165bc3023cd3ac2192da56c21dc4db88647c369d5043a8' WHERE email IN ('admin@northstar.test', 'ops@northstar.test') AND password_hash NOT LIKE 'scrypt$%';