-- 004_commerce.sql
-- Customers, addresses, behavioral events, carts, orders, shipments, order events.

DROP TYPE IF EXISTS cart_status CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS shipment_status CASCADE;
CREATE TYPE cart_status AS ENUM ('active', 'abandoned', 'converted');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE shipment_status AS ENUM ('processed', 'in_transit', 'out_for_delivery', 'delivered', 'returned');

CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid,
  email             citext NOT NULL,
  first_name        text,
  last_name         text,
  phone             text,
  tags              text[] NOT NULL DEFAULT '{}',
  notes             text,
  total_spent_amount integer NOT NULL DEFAULT 0,
  orders_count      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE customer_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label        text,
  first_name   text,
  last_name    text,
  address1     text,
  address2     text,
  city         text,
  province     text,
  zip          text,
  country      text,
  is_default   boolean NOT NULL DEFAULT false,
  phone        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_addresses_customer ON customer_addresses (customer_id);

CREATE TABLE customer_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid,
  session_id  text,
  event_type  text NOT NULL,
  product_id  uuid,
  variant_id  uuid,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ce_tenant_type_date ON customer_events (tenant_id, event_type, created_at);

CREATE TABLE carts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid,
  discount_code text,
  status        cart_status NOT NULL DEFAULT 'active',
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carts_tenant_status ON carts (tenant_id, status, updated_at);

CREATE TABLE cart_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cart_id           uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES variants(id),
  quantity          integer NOT NULL DEFAULT 1,
  unit_price_amount integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id            uuid,
  number                 bigint,
  status                 order_status NOT NULL DEFAULT 'pending',
  email                  citext,
  subtotal_amount        integer NOT NULL DEFAULT 0,
  discount_amount        integer NOT NULL DEFAULT 0,
  shipping_amount        integer NOT NULL DEFAULT 0,
  tax_amount             integer NOT NULL DEFAULT 0,
  total_amount           integer NOT NULL DEFAULT 0,
  currency               char(3) NOT NULL DEFAULT 'usd',
  stripe_session_id      text,
  stripe_payment_intent  text,
  notes                  text,
  placed_at              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX idx_orders_tenant_date ON orders (tenant_id, placed_at DESC);
CREATE INDEX idx_orders_customer ON orders (customer_id);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id        uuid,
  product_title     text NOT NULL,
  variant_title     text NOT NULL,
  sku               text,
  unit_price_amount integer NOT NULL,
  quantity          integer NOT NULL,
  line_total_amount integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier         text,
  tracking_number text,
  status          shipment_status NOT NULL DEFAULT 'processed',
  shipped_at      timestamptz,
  address         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type       text NOT NULL,
  actor_id   uuid,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order ON order_events (order_id);