# BeautyAI — Database Schema

**PostgreSQL 16 Physical Data Model**

| Field | Value |
|---|---|
| **Product** | BeautyAI |
| **Doc Version** | 1.0 |
| **Status** | Draft |
| **Related** | PRD.md, TECH_SPEC.md, ARCHITECTURE.md, API.md |
| **Last Updated** | 2026-09-05 |

---

## 1. Conventions

| Convention | Value |
|---|---|
| Naming | `snake_case`; tables plural; PK `id` (UUID v7); FKs `<entity>_id` |
| Soft delete | `deleted_at timestamptz NULL` where applicable |
| Timestamps | `created_at`, `updated_at` on all tables |
| Tenant | Every business row has `tenant_id` → FK `tenants(id)` |
| Money | `integer` minor units (cents) |
| Text columns | use `TEXT` type, not VARCHAR(n), except constrained IDs |
| Migrations | Forward-only versioned SQL, tool-agnostic |

---

## 2. ERD Overview

```
tenants ─▶ users (tenant membership)
tenants ─▶ plans
tenants ─▶ brand_tones
tenants ─▶ seo_defaults

tenants ─▶ products ─▶ variants ─▶ inventory
   ├─▶ collections (m:n product_collection)
   ├─▶ images
   ├─▶ seo_metadata (product_seo)
   ├─▶ product attributes (product_materials/attributes JSONB)

tenants ─▶ carts ─▶ cart_items ─▶ discount
tenants ─▶ orders ─▶ order_items ─▶ shipments ─▶ order_events

tenants ─▶ customers ─▶ customer_addresses

tenants ─▶ content_drafts ─▶ content_versions ─▶ credit_ledger

tenants ─▶ audits ─▶ crawl_runs ─▶ crawl_urls
tenants ─▶ audit_issues ─▶ issue_fixes ─▶ seo_scores

tenants ─▶ analytics_connections ─▶ analytics_syncs
tenants ─▶ gsc_data, ga4_data, ads_data

tenants ─▶ recommendations

tenants ─▶ subscriptions ─▶ invoices ─▶ feature_quotas
```

---

## 3. Schema DDL

> DDL shown with representative columns; full column sets included per table.

### 3.1 Tenancy & Accounts

#### `tenants`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | v7 |
| `name` | text NOT NULL | |
| `slug` | text NOT NULL UNIQUE | store subdomain |
| `custom_domain` | text UNIQUE NULL | branded CNAME |
| `currency` | char(3) DEFAULT 'usd' | |
| `locale` | text DEFAULT 'en' | |
| `status` | tenant_status DEFAULT 'active' | active/suspended/trial |
| `trial_ends_at` | timestamptz NULL | |
| `logo_url` | text NULL | |
| `settings` | jsonb DEFAULT '{}' | feature flags, defaults |
| `created_at`/`updated_at` | timestamptz | |

#### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | citext NOT NULL UNIQUE | case-insensitive |
| `password_hash` | text NULL | argon2id; null = OAuth/social |
| `full_name` | text NULL | |
| `status` | user_status DEFAULT 'active' | |
| `last_login_at` | timestamptz NULL | |
| `created_at`/`updated_at` | timestamptz | |

#### `tenant_memberships`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK → tenants | |
| `user_id` | uuid FK → users | |
| `role` | role_enum NOT NULL | owner/editor/viewer |
| `status` | invite_status DEFAULT 'active' | active/pending/revoked |
| `invited_by` | uuid NULL | |
| UNIQUE | `(tenant_id, user_id)` | |

#### `refresh_tokens`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `user_id` | uuid FK |
| `tenant_id` | uuid FK |
| `token_hash` | text UNIQUE |
| `expires_at` | timestamptz |
| `revoked_at` | timestamptz NULL |

---

### 3.2 Catalogy

#### `products`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK NOT NULL | |
| `title` | text NOT NULL | |
| `handle` | text NOT NULL | unique per tenant |
| `description` | text | rich/short |
| `body_html` | text | rendered long-form |
| `status` | product_status DEFAULT 'draft' | draft/active/archived |
| `vendor` | text | |
| `product_type` | text | |
| `tags` | text[] DEFAULT '{}' | |
| `attributes` | jsonb DEFAULT '{}' | skin_type[], ingredients[], benefits[] |
| `template` | text NULL | custom page template |
| `published_at` | timestamptz NULL | |
| `created_at`/`updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, handle)` | |

#### `variants`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `product_id` | uuid FK → products | |
| `title` | text NOT NULL | "30ml" |
| `sku` | text NOT NULL | unique per tenant |
| `barcode` | text NULL | |
| `price_amount` | int NOT NULL | cents |
| `compare_at_price` | int NULL | cents |
| `weight_g` | int NULL | |
| `option_values` | jsonb DEFAULT '{}' | `{ size: "30ml", color: "rose" }` |
| `position` | int DEFAULT 0 | |
| `is_default` | bool DEFAULT false | |
| `created_at`/`updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, sku)` | |

#### `inventory`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `variant_id` | uuid FK → variants | |
| `quantity` | int NOT NULL DEFAULT 0 | |
| `tracked` | bool DEFAULT true | |
| `low_stock_threshold` | int NULL | |
| `updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, variant_id)` | |

#### `collections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `title` | text NOT NULL | |
| `handle` | text NOT NULL | unique per tenant |
| `description` | text | |
| `rule` | jsonb NULL | automated membership `{ field, operator, value }` |
| `sort_order` | text DEFAULT 'manual' | manual/created/price |
| `published` | bool NOT NULL DEFAULT true |
| `image_url` | text NULL |
| `created_at`/`updated_at` | timestamptz | |

#### `product_collection`

| Column | Type |
|---|---|
| `product_id` | uuid FK |
| `collection_id` | uuid FK |
| `position` | int DEFAULT 0 |
| PK | `(product_id, collection_id)` |

#### `product_images`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `product_id` | uuid FK | |
| `url` | text NOT NULL | S3 key |
| `alt` | text NULL | alt text (SEO) |
| `position` | int DEFAULT 0 | |
| `width`/`height` | int NULL | |
| `created_at` | timestamptz | |

#### `product_seo`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `product_id` | uuid FK | |
| `meta_title` | text | ≤60 chars |
| `meta_description` | text | ≤160 chars |
| `keywords` | text[] | |
| `og_title` | text NULL | |
| `og_description` | text NULL |
| `canonical_url` | text NULL |
| `updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, product_id)` | |

---

### 3.3 Commerce

#### `carts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `customer_id` | uuid FK NULL | |
| `discount_code` | text NULL | |
| `status` | cart_status DEFAULT 'active' | active/abandoned/converted |
| `expires_at` | timestamptz | |
| `created_at`/`updated_at` | timestamptz | |

#### `cart_items`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `cart_id` | uuid FK |
| `variant_id` | uuid FK |
| `quantity` | int NOT NULL DEFAULT 1 |
| `unit_price_amount` | int |
| `created_at` | timestamptz |

#### `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `customer_id` | uuid FK NULL | guest allowed |
| `number` | bigint | per-tenant sequence (e.g., #1001) |
| `status` | order_status DEFAULT 'pending' | |
| `subtotal_amount` | int NOT NULL | cents |
| `discount_amount` | int DEFAULT 0 | |
| `shipping_amount` | int DEFAULT 0 | |
| `tax_amount` | int DEFAULT 0 | |
| `total_amount` | int NOT NULL | |
| `currency` | char(3) | |
| `stripe_session_id` | text NULL | |
| `stripe_payment_intent` | text NULL | |
| `email` | citext NULL | guest email |
| `notes` | text NULL | |
| `placed_at` | timestamptz NOT NULL |
| `updated_at` | timestamptz | |

Status enum: `pending, paid, fulfilled, shipped, delivered, cancelled, refunded`.

#### `order_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `order_id` | uuid FK | |
| `variant_id` | uuid FK | snapshot link (soft; variant may change) |
| `product_title` | text | snapshot copy |
| `variant_title` | text | snapshot |
| `sku` | text | snapshot |
| `unit_price_amount` | int | |
| `quantity` | int | |
| `line_total_amount` | int | |

#### `shipments`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `order_id` | uuid FK |
| `carrier` | text |
| `tracking_number` | text |
| `status` | shipment_status |
| `shipped_at` | timestamptz NULL |
| `address` | jsonb (shipping address snapshot) |

#### `order_events`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `order_id` | uuid FK |
| `type` | text (created, paid, fulfilled, cancelled…) |
| `actor_id` | uuid NULL (user/customer) |
| `metadata` | jsonb |
| `created_at` | timestamptz |

---

### 3.4 Customers

#### `customers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `user_id` | uuid FK NULL | links to platform account |
| `email` | citext NOT NULL | unique per tenant |
| `first_name` / `last_name` | text | |
| `phone` | text NULL | |
| `tags` | text[] | |
| `notes` | text NULL | |
| `total_spent_amount` | int DEFAULT 0 | |
| `orders_count` | int DEFAULT 0 | |
| `created_at`/`updated_at` | timestamptz | |

#### `customer_addresses`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `customer_id` | uuid FK |
| `label` | text NULL (Home/Work) |
| `first_name`/`last_name` | text |
| `address1`/`address2` | text |
| `city`/`province`/`zip`/`country` | text |
| `is_default` | bool |
| `phone` | text NULL |

#### `customer_events` (behavioral)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `customer_id` | uuid FK NULL | anonymous ok |
| `session_id` | text NULL | |
| `event_type` | text | page_view/product_view/add_to_cart/order |
| `product_id`/`variant_id` | uuid NULL | |
| `payload` | jsonb | |
| `created_at` | timestamptz | partition by month later |

---

### 3.5 AI Content

#### `brand_tones`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK UNIQUE |
| `name` | text |
| `voice` | text (e.g., "warm, natural, evidence-based") |
| `forbidden_words` | text[] |
| `preferred_terms` | jsonb |
| `sample_phrases` | text[] |
| `language` | text DEFAULT 'en' |
| `updated_at` | timestamptz |

#### `content_drafts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `type` | content_type | product_description/meta/blog |
| `target_type`/`target_id` | text/uuid | product or blog target |
| `title` | text | |
| `body` | text | main generated text |
| `meta_title`/`meta_description` | text | SEO fields |
| `status` | draft_status DEFAULT 'draft' | draft/approved/published/rejected |
| `llm_model` | text | model id used |
| `prompt_snapshot` | jsonb | for reproducibility |
| `created_by` | uuid | user that requested |
| `published_at`/`approved_at` | timestamptz NULL |
| `created_at`/`updated_at` | timestamptz |

#### `content_versions`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `draft_id` | uuid FK |
| `version` | int |
| `body`/`meta_title`/`meta_description` | text |
| `change_summary` | text |
| `created_by` | uuid |
| `created_at` | timestamptz |

#### `credit_ledger`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `customer_id`/`user_id` | uuid NULL | actor |
| `operation` | text | grant/consume/refund |
| `amount` | int | +/- credits |
| `metadata` | jsonb | content type, model |
| `created_at` | timestamptz | |

---

### 3.6 SEO Audit

#### `audits`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `name` | text | |
| `status` | audit_status DEFAULT 'queued' | queued/running/completed/failed |
| `crawl_depth` | int DEFAULT 3 | |
| `exclude_patterns` | text[] | |
| `total_urls` | int DEFAULT 0 | |
| `progress` | int DEFAULT 0 | processed urls |
| `started_at`/`completed_at` | timestamptz NULL |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

#### `crawl_urls`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `audit_id` | uuid FK |
| `tenant_id` | uuid FK |
| `url` | text NOT NULL |
| `status` | int (http status) |
| `title` | text NULL |
| `meta_description` | text NULL |
| `meta_title_length` / `meta_description_length` | int |
| `has_h1` | bool |
| `has_canonical` | bool |
| `is_indexable` | bool |
| `word_count` | int |
| `images_without_alt` | int |
| `broken_links` | int |
| `lighthouse_score` | jsonb (perf/accessibility/best-practices/SEO) |
| `crawled_at` | timestamptz |
| UNIQUE | `(audit_id, url)` |

#### `audit_issues`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `audit_id` | uuid FK |
| `type` | text (missing_meta_description, duplicate_titles, missing_alt, no_schema, broken_link, thin_content, slow_page, no_canonical…) |
| `url` | text |
| `severity` | text (critical/high/medium/low) |
| `impact_score` | int 0–100 |
| `status` | issue_status (open/fixed/dismissed) |
| `recommended_fix` | jsonb |
| `fixed_at` | timestamptz NULL |
| `created_at` | timestamptz |
| UNIQUE | `(audit_id, url, type)` |

#### `seo_scores`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `audit_id` | uuid FK NULL |
| `score` | int 0–100 |
| `categories` | jsonb (`{ meta, content, technical, performance, mobile, indexability }`) |
| `created_at` | timestamptz |
| UNIQUE | `(tenant_id, created_at)` |

#### `issue_fixes`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `issue_id` | uuid FK |
| `type` | text (auto_generated, manual, dismissed) |
| `before`/`after` | jsonb NULL |
| `result` | text (applied/failed) |
| `created_by` | uuid |
| `created_at` | timestamptz |

---

### 3.7 Analytics

#### `analytics_connections`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `provider` | text (gsc/ga4/ads) |
| `account_id` | text (GSC property, GA4 property, Ads customer id) |
| `access_token_enc` | text (encrypted) |
| `refresh_token_enc` | text (encrypted) |
| `token_expires_at` | timestamptz |
| `status` | text (connected/expired/error) |
| `last_sync_at` | timestamptz NULL |
| `settings` | jsonb |
| UNIQUE | `(tenant_id, provider)` |

#### `analytics_syncs`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `provider` | text |
| `status` | text (started/success/failed) |
| `started_at`/`finished_at` | timestamptz |
| `records_processed` | int |
| `error` | text NULL |

#### `gsc_data`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `date` | date | |
| `query` | text | dimension |
| `page` | text NULL | page URL dimension |
| `country`/`device` | text NULL | |
| `clicks` | int | |
| `impressions` | int | |
| `ctr` | numeric(5,4) | |
| `position` | numeric(6,2) | |
| `updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, date, query, page, country, device)` | |

#### `ga4_data`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `date` | date |
| `source`/`medium`/`campaign` | text NULL |
| `landing_page` | text NULL |
| `sessions` | int |
| `users` | int |
| `new_users` | int |
| `engagement_rate` | numeric |
| `conversions` | int |
| `revenue_amount` | int |
| `updated_at` | timestamptz |

#### `ads_data`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `date` | date |
| `campaign_id`/`campaign_name` | text |
| `ad_group` | text NULL |
| `keyword` | text NULL |
| `clicks` | int |
| `impressions` | int |
| `cost_micros` | bigint |
| `conversions` | int |
| `conversion_value_micros` | bigint |
| `updated_at` | timestamptz |

---

### 3.8 Recommendations

#### `rec_strategies`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK UNIQUE | |
| `config` | jsonb | `{ related: {...}, bought_together: {...}, home: {...} }` weights |
| `updated_at` | timestamptz | |

#### `product_recommendations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `source_product_id` | uuid FK NULL | null = homepage |
| `recommended_product_id` | uuid FK | |
| `strategy` | text (co_purchase/popular/related/personalized) |
| `score` | numeric | |
| `rank` | int | |
| `generated_at` | timestamptz | |
| UNIQUE | `(tenant_id, source_product_id, recommended_product_id, strategy)` | |

---

### 3.9 Billing

#### `plans`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `code` | text UNIQUE (starter/growth/scale) |
| `name` | text |
| `price_monthly` | int (cents) |
| `price_yearly` | int NULL |
| `features` | jsonb (quota limits, feature flags) |
| `active` | bool |

#### `subscriptions`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK UNIQUE |
| `plan_id` | uuid FK |
| `stripe_subscription_id` | text |
| `stripe_customer_id` | text |
| `status` | text |
| `current_period_end` | timestamptz |
| `cancel_at_period_end` | bool DEFAULT false |
| `created_at`/`updated_at` | timestamptz |

#### `invoices`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `stripe_invoice_id` | text |
| `amount_due` | int |
| `amount_paid` | int |
| `status` | text |
| `invoice_pdf` | text NULL |
| `created_at` | timestamptz |

#### `feature_quotas`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `feature` | text (content_credits, crawl_frequency, stores, api_access) |
| `used` | int DEFAULT 0 | |
| `quota_limit` | int | from plan |
| `period_start` | timestamptz | |
| `updated_at` | timestamptz | |

---

### 3.10 Settings & Audit

#### `settings`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK UNIQUE |
| `key` | text |
| `value` | jsonb |
| `updated_at` | timestamptz |
| UNIQUE | `(tenant_id, key)` |

#### `seo_defaults`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK UNIQUE |
| `default_meta_title` / `default_meta_description` | text |
| `og_image` | text |
| `organization_name` | text |
| `schema_org` | jsonb |
| `robots_txt` | text NULL |
| `updated_at` | timestamptz |

#### `audit_logs`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id` | uuid FK |
| `user_id` | uuid NULL |
| `action` | text (e.g., product.update) |
| `resource_type`/`resource_id` | text/uuid |
| `before`/`after` | jsonb NULL |
| `ip` | text NULL |
| `created_at` | timestamptz |

---

## 4. Indexes

| Table | Index | Type |
|---|---|---|
| products | `idx_products_tenant_status` on `(tenant_id, status)` | btree |
| products | `idx_products_tenant_handle` on `(tenant_id, handle)` | btree (unique) |
| products | `idx_products_title_trgm` on `title` | GIN `pg_trgm` (search) |
| variants | `idx_variants_tenant_sku` on `(tenant_id, sku)` | unique |
| variants | `idx_variants_product` on `(product_id)` | btree |
| orders | `idx_orders_tenant_date` on `(tenant_id, placed_at desc)` | btree |
| orders | `idx_orders_customer` on `(customer_id)` | btree |
| customer_events | `idx_ce_tenant_type_date` on `(tenant_id, event_type, created_at)` | btree |
| crawl_urls | `idx_crawlurls_audit` on `(audit_id)` | btree |
| audit_issues | `idx_issues_tenant_status` on `(tenant_id, status, severity)` | btree |
| gsc_data | `idx_gsc_tenant_date` on `(tenant_id, date)` | btree |
| gsc_data | `idx_gsc_tenant_query` on `(tenant_id, query)` | btree |
| product_recommendations | `idx_rec_source` on `(tenant_id, source_product_id)` | btree |
| content_drafts | `idx_drafts_tenant_status` on `(tenant_id, status)` | btree |

---

## 5. Enums

```
tenant_status        : active | suspended | trialing
user_status          : active | disabled
role_enum            : owner | editor | viewer
invite_status        : active | pending | revoked
product_status       : draft | active | archived
cart_status          : active | abandoned | converted
order_status         : pending | paid | fulfilled | shipped | delivered | cancelled | refunded
shipment_status      : processed | in_transit | out_for_delivery | delivered | returned
content_type         : product_description | meta | blog
draft_status         : draft | approved | published | rejected
audit_status         : queued | running | completed | failed
issue_status         : open | fixed | dismissed
```

---

## 6. Data Retention & Purging

| Dataset | Retention | Action |
|---|---|---|
| GSC/GA4/Ads raw | 24 months default (configurable) | partition by month, drop old |
| crawl_urls | keep latest 30 audits per tenant | prune older |
| customer_events | 24 months | partition/drop |
| refresh_tokens | 90 days after revocation | delete |
| audit_logs | 12 months | archive to S3 then delete |

---

## 7. Migration Strategy

- Versioned SQL migrations in `migrations/` dir, forward-only
- Squash to baseline on first production release
- Run under advisory lock; zero-downtime additive changes only
- Large table changes use shadow tables + rename (e.g., `gsc_data_materials`)

---

*End of Database Schema v1.0*