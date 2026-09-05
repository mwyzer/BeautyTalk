-- 006_audit.sql
-- SEO audits, crawl runs/urls, issues, scores, fixes.

DROP TYPE IF EXISTS audit_status CASCADE;
DROP TYPE IF EXISTS issue_status CASCADE;
CREATE TYPE audit_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE issue_status AS ENUM ('open', 'fixed', 'dismissed');

CREATE TABLE audits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text,
  status           audit_status NOT NULL DEFAULT 'queued',
  crawl_depth      integer NOT NULL DEFAULT 3,
  exclude_patterns text[] NOT NULL DEFAULT '{}',
  total_urls       integer NOT NULL DEFAULT 0,
  progress         integer NOT NULL DEFAULT 0,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audits_tenant_created ON audits (tenant_id, created_at DESC);

CREATE TABLE crawl_urls (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id                  uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url                       text NOT NULL,
  status                    integer,
  title                     text,
  meta_description          text,
  meta_title_length         integer,
  meta_description_length   integer,
  has_h1                    boolean,
  has_canonical             boolean,
  is_indexable              boolean,
  word_count                integer,
  images_without_alt        integer,
  broken_links              integer,
  lighthouse_score          jsonb,
  crawled_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, url)
);

CREATE INDEX idx_crawlurls_audit ON crawl_urls (audit_id);

CREATE TABLE audit_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  audit_id         uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  type             text NOT NULL,
  url              text,
  severity         text NOT NULL,
  impact_score     integer NOT NULL DEFAULT 0,
  status           issue_status NOT NULL DEFAULT 'open',
  recommended_fix  jsonb,
  fixed_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, url, type)
);

CREATE INDEX idx_issues_tenant_status ON audit_issues (tenant_id, status, severity);

CREATE TABLE seo_scores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  audit_id   uuid REFERENCES audits(id) ON DELETE SET NULL,
  score      integer NOT NULL,
  categories jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, created_at)
);

CREATE TABLE issue_fixes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issue_id    uuid NOT NULL REFERENCES audit_issues(id) ON DELETE CASCADE,
  type        text NOT NULL,
  before      jsonb,
  after       jsonb,
  result      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);