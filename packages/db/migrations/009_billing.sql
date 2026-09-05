-- 009_billing.sql
-- Plans, subscriptions, invoices, feature quotas.

CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  price_monthly   integer NOT NULL DEFAULT 0,
  price_yearly    integer,
  features        jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                uuid NOT NULL REFERENCES plans(id),
  stripe_subscription_id text,
  stripe_customer_id     text,
  status                 text NOT NULL DEFAULT 'trialing',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text,
  amount_due        integer NOT NULL DEFAULT 0,
  amount_paid       integer NOT NULL DEFAULT 0,
  status            text NOT NULL,
  invoice_pdf       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_tenant ON invoices (tenant_id, created_at DESC);

CREATE TABLE feature_quotas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature       text NOT NULL,
  used          integer NOT NULL DEFAULT 0,
  quota_limit   integer NOT NULL DEFAULT 0,
  period_start  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature)
);