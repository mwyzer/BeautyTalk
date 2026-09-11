-- 011_fraud.sql
-- Fraud detection: per-tenant rule config + flagged-order review queue.

CREATE TABLE fraud_configs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE fraud_flag_status AS ENUM ('open', 'cleared', 'blocked');

CREATE TABLE fraud_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  rules       text[] NOT NULL DEFAULT '{}',
  risk_score  integer NOT NULL DEFAULT 0,
  status      fraud_flag_status NOT NULL DEFAULT 'open',
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_id)
);

CREATE INDEX idx_fraud_flags_tenant_status ON fraud_flags (tenant_id, status, created_at DESC);
CREATE INDEX idx_fraud_flags_order ON fraud_flags (tenant_id, order_id);
CREATE INDEX idx_fraud_flags_customer ON fraud_flags (tenant_id, customer_id);