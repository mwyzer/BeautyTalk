# BeautyAI — API Specification

**API Reference (REST, v1)**

| Field | Value |
|---|---|
| **Product** | BeautyAI |
| **Doc Version** | 1.0 |
| **Status** | Draft |
| **Related** | PRD.md, TECH_SPEC.md, ARCHITECTURE.md, DATABASE_SCHEMA.md |
| **Last Updated** | 2026-09-05 |

---

## 1. Conventions

| Convention | Value |
|---|---|
| Base URL | `https://api.beautyai.app/api/v1` |
| Protocol | HTTPS only |
| Data format | `application/json` (UTF-8) |
| Auth | `Authorization: Bearer <JWT>` |
| Pagination | `?page=1&limit=25` → `{ data, meta: { page, limit, total } }` |
| Sorting | `?sort=-created_at` (prefix `-` = desc) |
| Filtering | `?filter[status]=draft` |
| Errors | RFC 7807 `application/problem+json` |
| Rate limiting | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |

### 1.1 Error Format

```json
{
  "type": "https://errors.beautyai.app/validation",
  "title": "Validation Error",
  "status": 422,
  "detail": "meta['title'] must be 60 characters or fewer",
  "instance": "/api/v1/content/drafts",
  "request_id": "req_abc123"
}
```

Common status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 503.

---

## 2. Authentication & Authorization

### 2.1 Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create tenant + owner user (onboarding) |
| POST | `/auth/login` | Email/password → `{ access_token, refresh_token, user, tenant }` |
| POST | `/auth/refresh` | Exchange refresh token |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/password/reset` | Request password reset (email) |
| POST | `/auth/password/confirm` | Confirm reset with token |
| GET | `/auth/me` | Current user + permissions |

### 2.2 Scopes / Permissions

JWT claims: `sub`, `tenant_id`, `role` (owner|editor|viewer), `exp`, `iss`.

| Role | Read | Write | Manage billing / integrations |
|---|---|---|---|
| owner | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | — |
| viewer | ✓ | — | — |

---

## 3. Products

### 3.1 Product Object

```json
{
  "id": "prod_01HX...",
  "tenant_id": "ten_01",
  "title": "Vitamin C Brightening Serum",
  "handle": "vitamin-c-brightening-serum",
  "description": "…",
  "body_html": "…",
  "status": "active",
  "vendor": "Glow Co.",
  "product_type": "Serums",
  "tags": ["vitamin-c", "brightening"],
  "images": [{ "id": "img_..", "url": "...", "alt": "..." }],
  "variants": [
    {
      "id": "var_..", "title": "30ml", "sku": "VC-SERUM-30",
      "price_amount": 4500, "compare_at_price": 5500,
      "inventory_qty": 120, "weight_g": 90, "barcode": "..."
    }
  ],
  "seo": { "title": "...", "description": "...", "keywords": ["..."] },
  "attributes": { "skin_type": ["all"], "ingredients": ["vitamin-c"], "benefits": ["brightening"] },
  "created_at": "...", "updated_at": "..."
}
```

Prices in **minor units** (cents). SKU unique per tenant.

### 3.2 Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/products` | List (filter by status/type/collection/tag; search `?q=`) | Any (store) |
| GET | `/products/{handle}` | Storefront product detail (public, plus SEO meta) | Public |
| POST | `/products` | Create product | editor+ |
| GET | `/admin/products` | Admin list (all statuses) | editor+ |
| GET | `/admin/products/{id}` | Admin detail | editor+ |
| PATCH | `/admin/products/{id}` | Update product | editor+ |
| DELETE | `/admin/products/{id}` | Soft-delete | owner |
| POST | `/admin/products/{id}/publish` | Publish/unpublish | editor+ |
| POST | `/admin/products/{id}/images` | Upload image(s) → S3-presigned | editor+ |
| PATCH | `/admin/products/{id}/images/{img_id}` | Update image metadata/alt | editor+ |
| DELETE | `/admin/products/{id}/images/{img_id}` | Delete image | editor+ |

### 3.3 Collections

| Method | Path | Description |
|---|---|---|
| GET | `/collections` | List collections |
| GET | `/collections/{handle}` | Collection with products |
| POST | `/admin/collections` | Create |
| PATCH | `/admin/collections/{id}` | Update (manual products or automated rule) |
| DELETE | `/admin/collections/{id}` | Delete |
| POST | `/admin/collections/{id}/products/{product_id}` | Add product |
| DELETE | `/admin/collections/{id}/products/{product_id}` | Remove product |

---

## 4. Cart & Checkout

| Method | Path | Description |
|---|---|---|
| POST | `/carts` | Create cart → `{ cart_id }` |
| GET | `/carts/{id}` | Get cart |
| POST | `/carts/{id}/items` | Add item (variant_id, qty) |
| PATCH | `/carts/{id}/items/{item_id}` | Update qty |
| DELETE | `/carts/{id}/items/{item_id}` | Remove item |
| POST | `/carts/{id}/discount` | Apply discount code |
| DELETE | `/carts/{id}/discount` | Remove discount |
| POST | `/checkout/sessions` | Create Stripe Checkout session from cart |
| GET | `/checkout/sessions/{id}` | Checkout status (open/complete/expired) |
| GET | `/checkout/confirm/{session_id}` | Public confirmation page payload |
| POST | `/webhooks/stripe` | Stripe webhook (checkout.completed etc.) |

Flow: cart → checkout session → redirect to Stripe → webhook → order created → email.

---

## 5. Orders

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/admin/orders` | List orders (filter status/date) | editor+ |
| GET | `/admin/orders/{id}` | Order detail incl. items/events | editor+ |
| PATCH | `/admin/orders/{id}` | Update status (confirmed→fulfilled etc.), notes | editor+ |
| POST | `/admin/orders/{id}/fulfill` | Fulfill shipment (carrier, tracking) | editor+ |
| POST | `/admin/orders/{id}/refund` | Refund (Stripe) | owner |
| POST | `/admin/orders/{id}/cancel` | Cancel order | editor+ |

Order statuses: `pending, paid, fulfilled, shipped, delivered, cancelled, refunded`.

---

## 6. Customers

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Customer self-registration (orders history) |
| GET | `/me/orders` | Customer's own order history |
| GET | `/me/addresses` | Customer addresses |
| POST | `/me/addresses` | Add address |
| PATCH | `/me/addresses/{id}` | Update/Set primary |
| DELETE | `/me/addresses/{id}` | Delete |
| GET | `/admin/customers` | List customers (search/filter) |
| GET | `/admin/customers/{id}` | Customer detail + order history |
| PATCH | `/admin/customers/{id}` | Update customer, add notes/tags |

---

## 7. AI Content Engine

| Method | Path | Description |
|---|---|---|
| POST | `/content/generate` | Queue generation → `{ job_id }`; poll `GET /content/generate/{job_id}` |
| GET | `/content/generate/{job_id}` | Job status → `{ status, draft_id? }` |
| POST | `/content/generate/bulk` | Generate for multiple product ids (config: fields, tone) |
| GET | `/content/drafts` | List drafts (filter status) |
| GET | `/content/drafts/{id}` | Draft detail incl. versions |
| PATCH | `/content/drafts/{id}` | Edit draft |
| POST | `/content/drafts/{id}/publish` | Publish to product |
| DELETE | `/content/drafts/{id}` | Discard draft |
| POST | `/content/drafts/{id}/versions/{version}/restore` | Restore version |
| GET | `/content/credits` | Credit balance + usage history |
| GET | `/content/brand-tone` | Get brand tone config |
| PUT | `/content/brand-tone` | Set brand tone (voice, forbidden words, language style) |

### 7.1 Generate Request

```json
{
  "product_id": "prod_01",
  "fields": ["description", "meta_title", "meta_description"],
  "language": "en",
  "tone": "luxury-warm"
}
```

### 7.2 Generate Response (job)

```json
{
  "job_id": "job_01",
  "status": "completed",
  "draft_id": "draft_01",
  "fields": {
    "description": "A silky dermatologist-grade formula…",
    "meta_title": "Vitamin C Brightening Serum | Glow Co. (58 chars)",
    "meta_description": "…"
  },
  "validation": { "char_lengths": { "meta_title": 58 }, "ok": true }
}
```

---

## 8. SEO Auditor

| Method | Path | Description |
|---|---|---|
| POST | `/audits/crawls` | Start crawl `{ seed_urls?, depth, options }` → crawl record |
| GET | `/audits/crawls` | List crawl runs |
| GET | `/audits/crawls/{id}` | Crawl detail + progress |
| GET | `/audits/crawls/{id}/urls` | Crawled URLs + per-page status |
| POST | `/audits/crawls/{id}/cancel` | Cancel crawl |
| GET | `/audits/issues` | Fix queue (filter severity/type/status) |
| GET | `/audits/issues/{id}` | Issue detail incl. affected urls |
| POST | `/audits/issues/{id}/fix` | One-click auto-fix (meta/alt/schema) → result |
| GET | `/audits/score` | SEO score + category breakdown + trend |
| GET | `/audits/options` | Crawl config (bots, exclusions, schedules) |
| PUT | `/audits/options` | Update crawl config |
| POST | `/audits/schedule` | Enable/disable scheduled crawls |

### 8.1 Issue Object

```json
{
  "id": "iss_01",
  "type": "missing_meta_description",
  "severity": "high",
  "impact_score": 87,
  "status": "open",
  "label": "Missing meta description",
  "affected_urls": 42,
  "traffic_estimate": 1200,
  "fix": { "type": "auto", "action": "generate_meta_description" }
}
```

### 8.2 SEO Score

```json
{
  "score": 71,
  "categories": {
    "meta": 82, "content": 64, "technical": 78,
    "performance": 68, "mobile": 80, "indexability": 74
  },
  "trend": [{ "date": "2026-09-01", "score": 68 }, { "date": "2026-09-05", "score": 71 }]
}
```

---

## 9. Analytics (GSC / GA4 / Ads)

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/integrations` | Connected integrations + status |
| POST | `/analytics/integrations/gsc` | Connect GSC (OAuth flow) |
| POST | `/analytics/integrations/ga4` | Connect GA4 |
| POST | `/analytics/integrations/ads` | Connect Google Ads |
| DELETE | `/analytics/integrations/{provider}` | Disconnect |
| POST | `/analytics/sync` | Trigger sync now |
| GET | `/analytics/sync/status` | Last sync per provider |
| GET | `/analytics/overview` | Unified KPI dashboard payload (KPIs, trends, breakdowns) |
| GET | `/analytics/gsc/queries` | Query report (clicks, impressions, ctr, position) |
| GET | `/analytics/gsc/pages` | Page report |
| GET | `/analytics/ga4/overview` | Sessions, users, engagement, conversions |
| GET | `/analytics/ads/overview` | Spend, ROAS, CTR, campaigns |

### 9.1 Shared Query Params

`?start=2026-08-01&end=2026-09-05&dimension=query&sort=-clicks&limit=50`

---

## 10. Recommendations

| Method | Path | Description |
|---|---|---|
| GET | `/products/{handle}/related` | "You May Also Like" (public) |
| GET | `/products/{handle}/bought-together` | "Customers Also Bought" (public) |
| GET | `/home/recommended` | Personalized homepage recs (optional customer context) |
| GET | `/admin/recommendations/strategies` | List strategies |
| PUT | `/admin/recommendations/strategies` | Configure strategies (popular/related/recent/hybrid, weights) |
| POST | `/admin/recommendations/refresh` | Trigger recompute now |

### 10.1 Related Response

```json
{
  "products": [
    { "id": "prod_02", "handle": "…", "title": "…", "price_amount": 4900,
      "image": "…", "alt": "…", "reason": "co_purchase", "score": 0.92 }
  ]
}
```

---

## 11. Billing & Subscriptions

| Method | Path | Description |
|---|---|---|
| GET | `/billing/plan` | Current plan + quotas |
| POST | `/billing/checkout` | Create Stripe Billing checkout (plan id) |
| POST | `/billing/portal` | Stripe customer portal URL |
| POST | `/billing/cancel` | Cancel / downgrade |
| GET | `/billing/invoices` | Invoices/payments history |
| GET | `/billing/credits` | Credit ledger (AI content credits) |
| POST | `/webhooks/stripe` | Stripe webhook (invoice.paid, subscription.updated, payment_failed) |

Plans enum: `starter, growth, scale`.

---

## 12. Tenant & Settings

| Method | Path | Description |
|---|---|---|
| GET | `/tenant` | Store config (name, domain, currency, logo) |
| PATCH | `/tenant` | Update store config |
| GET | `/tenant/seo-defaults` | Default meta/social templates |
| PUT | `/tenant/seo-defaults` | Update |
| GET | `/admin/users` | List team users |
| POST | `/admin/users` | Invite user (role) |
| PATCH | `/admin/users/{id}` | Update role |
| DELETE | `/admin/users/{id}` | Remove user |
| GET | `/admin/audit-logs` | Mutation audit trail |

---

## 13. API Usage Examples

### 13.1 Generate content with curl

```bash
curl -X POST https://api.beautyai.app/api/v1/content/generate \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "prod_01HXabc",
    "fields": ["description", "meta_title", "meta_description"],
    "tone": "warm-approachable"
  }'

# → { "job_id": "job_01", "status": "queued" }
```

Poll:

```bash
curl https://api.beautyai.app/api/v1/content/generate/job_01 \
  -H "Authorization: Bearer <JWT>"
```

### 13.2 Start a crawl

```bash
curl -X POST https://api.beautyai.app/api/v1/audits/crawls \
  -H "Authorization: Bearer <JWT>" \
  -d '{"depth":3,"options":{"exclude":["/cart","/checkout"]}}'
```

---

## 14. Webhooks

| Webhook (Stripe) | Result |
|---|---|
| `checkout.session.completed` | Create order, mark paid, trigger fulfilment email |
| `invoice.paid` | Renew subscription, refresh quotas |
| `invoice.payment_failed` | Flag account, email customer, retry grace period |
| `customer.subscription.updated` | Upgrade/downgrade plan + quotas |
| `customer.subscription.deleted` | Downgrade to free/expire |

All webhooks verified via Stripe signature (`Stripe-Signature`). Respond 200 quickly; process async.

---

## 15. Versioning & Deprecation

- Path versioning (`/api/v1`) — breaking changes → new major version
- Deprecated endpoints return `Deprecation` header with sunset date
- Backward-compatible additive changes allowed within a version

---

*End of API Spec v1.0*