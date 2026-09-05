-- 002_tenancy.sql
-- Tenants, users, memberships, refresh tokens, settings, SEO defaults, audit logs.

DROP TYPE IF EXISTS tenant_status CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS role_enum CASCADE;
DROP TYPE IF EXISTS invite_status CASCADE;
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'trialing');
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE role_enum AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE invite_status AS ENUM ('active', 'pending', 'revoked');

CREATE TABLE tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  custom_domain  text UNIQUE,
  currency       char(3) NOT NULL DEFAULT 'usd',
  locale         text NOT NULL DEFAULT 'en',
  status         tenant_status NOT NULL DEFAULT 'active',
  trial_ends_at  timestamptz,
  logo_url       text,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text,
  full_name     text,
  status        user_status NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       role_enum NOT NULL,
  status     invite_status NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE seo_defaults (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  default_meta_title          text,
  default_meta_description    text,
  og_image                    text,
  organization_name           text,
  schema_org                  jsonb,
  robots_txt                  text,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid,
  action        text NOT NULL,
  resource_type text,
  resource_id   uuid,
  before        jsonb,
  after         jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);