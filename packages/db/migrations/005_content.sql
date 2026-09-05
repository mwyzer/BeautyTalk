-- 005_content.sql
-- Brand tones, AI content drafts, versions, credit ledger.

DROP TYPE IF EXISTS content_type CASCADE;
DROP TYPE IF EXISTS draft_status CASCADE;
CREATE TYPE content_type AS ENUM ('product_description', 'meta', 'blog');
CREATE TYPE draft_status AS ENUM ('draft', 'approved', 'published', 'rejected');

CREATE TABLE brand_tones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  name            text,
  voice           text,
  forbidden_words text[] NOT NULL DEFAULT '{}',
  preferred_terms jsonb,
  sample_phrases  text[] NOT NULL DEFAULT '{}',
  language        text NOT NULL DEFAULT 'en',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type             content_type NOT NULL,
  target_type      text,
  target_id        uuid,
  title            text,
  body             text,
  meta_title       text,
  meta_description text,
  status           draft_status NOT NULL DEFAULT 'draft',
  llm_model        text,
  prompt_snapshot  jsonb,
  created_by       uuid,
  approved_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drafts_tenant_status ON content_drafts (tenant_id, status);

CREATE TABLE content_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id         uuid NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  version          integer NOT NULL,
  body             text,
  meta_title       text,
  meta_description text,
  change_summary   text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version)
);

CREATE TABLE credit_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid,
  operation   text NOT NULL,
  amount      integer NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_ledger_tenant ON credit_ledger (tenant_id, created_at);