-- 008_recommendations.sql
-- Recommendation strategies and precomputed product recommendations.

CREATE TABLE rec_strategies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_recommendations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_product_id      uuid REFERENCES products(id) ON DELETE CASCADE,
  recommended_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  strategy               text NOT NULL,
  score                  numeric NOT NULL DEFAULT 0,
  rank                   integer NOT NULL DEFAULT 0,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_product_id, recommended_product_id, strategy)
);

CREATE INDEX idx_rec_source ON product_recommendations (tenant_id, source_product_id);
CREATE INDEX idx_rec_strategy ON product_recommendations (tenant_id, strategy);