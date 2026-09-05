-- 003_catalog.sql
-- Products, variants, inventory, collections, images, SEO metadata.

DROP TYPE IF EXISTS product_status CASCADE;
CREATE TYPE product_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  handle        text NOT NULL,
  description   text,
  body_html     text,
  status        product_status NOT NULL DEFAULT 'draft',
  vendor        text,
  product_type  text,
  tags          text[] NOT NULL DEFAULT '{}',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  template      text,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, handle)
);

CREATE INDEX idx_products_tenant_status ON products (tenant_id, status);
CREATE INDEX idx_products_title_trgm ON products USING GIN (title gin_trgm_ops);

CREATE TABLE variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title             text NOT NULL,
  sku               text NOT NULL,
  barcode           text,
  price_amount      integer NOT NULL,
  compare_at_price  integer,
  weight_g          integer,
  option_values     jsonb NOT NULL DEFAULT '{}'::jsonb,
  position          integer NOT NULL DEFAULT 0,
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX idx_variants_tenant_sku ON variants (tenant_id, sku);
CREATE INDEX idx_variants_product ON variants (product_id);

CREATE TABLE inventory (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id           uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity             integer NOT NULL DEFAULT 0,
  tracked              boolean NOT NULL DEFAULT true,
  low_stock_threshold  integer,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, variant_id)
);

CREATE TABLE collections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        text NOT NULL,
  handle       text NOT NULL,
  description  text,
  rule         jsonb,
  sort_order   text NOT NULL DEFAULT 'manual',
  published    boolean NOT NULL DEFAULT true,
  image_url    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, handle)
);

CREATE TABLE product_collection (
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, collection_id)
);

CREATE TABLE product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text,
  position    integer NOT NULL DEFAULT 0,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_images_product ON product_images (product_id);

CREATE TABLE product_seo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  meta_title        text,
  meta_description  text,
  keywords          text[] NOT NULL DEFAULT '{}',
  og_title          text,
  og_description    text,
  canonical_url     text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id)
);