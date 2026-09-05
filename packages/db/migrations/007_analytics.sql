-- 007_analytics.sql
-- Provider connections, sync logs, GSC/GA4/Ads normalized data.

CREATE TABLE analytics_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  account_id          text,
  access_token_enc    text,
  refresh_token_enc   text,
  token_expires_at    timestamptz,
  status              text NOT NULL DEFAULT 'connected',
  last_sync_at        timestamptz,
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE analytics_syncs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  status            text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  records_processed integer NOT NULL DEFAULT 0,
  error             text
);

CREATE INDEX idx_analytics_syncs_tenant ON analytics_syncs (tenant_id, started_at DESC);

CREATE TABLE gsc_data (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date        date NOT NULL,
  query       text,
  page        text,
  country     text,
  device      text,
  clicks      integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr         numeric(5,4) NOT NULL DEFAULT 0,
  position    numeric(6,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date, query, page, country, device)
);

CREATE INDEX idx_gsc_tenant_date ON gsc_data (tenant_id, date);
CREATE INDEX idx_gsc_tenant_query ON gsc_data (tenant_id, query);

CREATE TABLE ga4_data (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date             date NOT NULL,
  source           text,
  medium           text,
  campaign         text,
  landing_page     text,
  sessions         integer NOT NULL DEFAULT 0,
  users            integer NOT NULL DEFAULT 0,
  new_users        integer NOT NULL DEFAULT 0,
  engagement_rate  numeric(5,4) NOT NULL DEFAULT 0,
  conversions      integer NOT NULL DEFAULT 0,
  revenue_amount   integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date, source, medium, campaign, landing_page)
);

CREATE INDEX idx_ga4_tenant_date ON ga4_data (tenant_id, date);

CREATE TABLE ads_data (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date                     date NOT NULL,
  campaign_id              text,
  campaign_name            text,
  ad_group                 text,
  keyword                  text,
  clicks                   integer NOT NULL DEFAULT 0,
  impressions              integer NOT NULL DEFAULT 0,
  cost_micros              bigint NOT NULL DEFAULT 0,
  conversions              integer NOT NULL DEFAULT 0,
  conversion_value_micros  bigint NOT NULL DEFAULT 0,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date, campaign_id, ad_group, keyword)
);

CREATE INDEX idx_ads_tenant_date ON ads_data (tenant_id, date);