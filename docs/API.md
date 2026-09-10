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

### 1.2 Implementation Status (Phase 0–2)

The spec below is the target API for all phases. Sections marked **Implemented** are live behind the v1 router. P3 SEO Auditor and P4 Analytics are implemented (see §8/§9 notes); Recommendations and Billing remain backward-compatible designs.

**Implemented endpoint surface (Phase 0–2):**

| Area | Endpoints |
|---|---|
| Auth (merchant) | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `GET /tenant`, `GET /admin/users` |
| Public catalog | `GET /products`, `GET /products/{handle}`, `GET /collections`, `GET /collections/{handle}`, `GET /collections/{handle}/products` |
| Admin catalog | `GET/POST /admin/products`, `GET/PATCH/DELETE /admin/products/{id}`, `POST /admin/products/{id}/publish`, `GET/POST /admin/collections`, `PATCH/DELETE /admin/collections/{id}`, `POST|DELETE /admin/collections/{id}/products/{productId}` |
| Cart | `POST /carts`, `GET /carts/{id}`, `POST/PATCH/DELETE /carts/{id}/items(/{itemId})` |
| Checkout | `POST /checkout/sessions`, `GET /checkout/confirm/{sessionId}`, `POST /webhooks/stripe` |
| Orders | `GET /admin/orders`, `GET/PATCH /admin/orders/{id}`, `POST /admin/orders/{id}/fulfill`, `POST /admin/orders/{id}/cancel`, `POST /admin/orders/{id}/refund` |
| Customers | `POST /customers/register`, `POST /customers/login`, `GET /me/account`, `GET /me/orders`, `GET|POST /me/addresses`, `PATCH|DELETE /me/addresses/{id}`, `GET /admin/customers`, `GET|PATCH /admin/customers/{id}` |
| **AI Content** | `POST /admin/content/generate`, `GET /admin/content/drafts`, `GET/PATCH /admin/content/drafts/{id}`, `POST /admin/content/drafts/{id}/approve`/`reject`/`publish`, `GET /admin/content/drafts/{id}/versions`, `POST /admin/content/drafts/{id}/versions/{v}/restore`, `GET /admin/content/credits`, `GET|PUT /admin/content/brand-tone` |

**Storefront tenant resolution:** public and customer endpoints resolve the store from the `X-Tenant-Slug` request header (or `?slug=`). Missing/unknown slug → `404 Store not found`.

**JWT types:** merchant access tokens (`type: merchant`, role `owner|editor|viewer`) vs. customer tokens (`type: customer`). They are not interchangeable — a customer token on `/me` returns 401 and an owner token on `/me/account` returns 401.

**Checkout without Stripe (graceful degradation):** when `STRIPE_SECRET_KEY`/`CHECKOUT_*_URL` are unset, `POST /checkout/sessions` returns `503` with an explanatory message instead of crashing. The webhook route 400s on missing/invalid signatures, and `STRIPE_WEBHOOK_SECRET` must be configured to process events. Refunding an order with a recorded `stripe_payment_intent` calls Stripe; otherwise the refund is recorded locally.

**Content without OpenAI/Redis (graceful degradation):** without `OPENAI_API_KEY`, `POST /admin/content/generate` returns `503`. Without `REDIS_URL`, generation runs synchronously; with it, the request is queued (BullMQ `content-generate`) and returns `202`.

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

Implemented rows beneath. `POST /carts/{id}/discount` and `GET /checkout/sessions/{id}` are deferred.

| Method | Path | Description |
|---|---|---|
| POST | `/carts` | Create cart → `{ cart_id }` — **implemented** |
| GET | `/carts/{id}` | Get cart — **implemented** |
| POST | `/carts/{id}/items` | Add item (variant_id, qty) — **implemented** |
| PATCH | `/carts/{id}/items/{item_id}` | Update qty — **implemented** |
| DELETE | `/carts/{id}/items/{item_id}` | Remove item — **implemented** |
| POST | `/carts/{id}/discount` | Apply discount code (deferred) |
| DELETE | `/carts/{id}/discount` | Remove discount (deferred) |
| POST | `/checkout/sessions` | Create Stripe Checkout session from cart — **implemented** |
| GET | `/checkout/sessions/{id}` | Checkout status (open/complete/expired) — deferred |
| GET | `/checkout/confirm/{session_id}` | Public confirmation page payload — **implemented** |
| POST | `/webhooks/stripe` | Stripe webhook (checkout.session.completed) — **implemented** |

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

Implemented endpoints:

| Method | Path | Description |
|---|---|---|
| POST | `/customers/register` | Customer self-registration (tenant via `X-Tenant-Slug`) → `{ access_token, customer }` |
| POST | `/customers/login` | Customer login → `{ access_token, customer }` |
| GET | `/me/account` | Customer's own profile (customer JWT) |
| GET | `/me/orders` | Customer's own order history |
| GET | `/me/addresses` | Customer addresses |
| POST | `/me/addresses` | Add address |
| PATCH | `/me/addresses/{id}` | Update/Set primary |
| DELETE | `/me/addresses/{id}` | Delete |
| GET | `/admin/customers` | List customers (search `?q=`) |
| GET | `/admin/customers/{id}` | Customer detail + addresses |
| PATCH | `/admin/customers/{id}` | Update customer, add notes/tags |

---

## 7. AI Content Engine

All endpoints require a merchant JWT with `owner` or `editor` role and are scoped to the caller's tenant.

| Method | Path | Description |
|---|---|---|
| POST | `/admin/content/generate` | Generate drafts for 1–50 product ids (sync friend + async job) |
| GET | `/admin/content/drafts` | List drafts (filters: `status`, `type`, `page`, `limit`) |
| GET | `/admin/content/drafts/{id}` | Draft detail |
| PATCH | `/admin/content/drafts/{id}` | Edit draft (snapshots prior content into version history) |
| POST | `/admin/content/drafts/{id}/approve` | Approve draft (`draft` → `approved`) |
| POST | `/admin/content/drafts/{id}/reject` | Reject draft (`draft`/`approved` → `rejected`) |
| POST | `/admin/content/drafts/{id}/publish` | Publish approved draft to product (writes `description`/`body_html` + SEO meta) |
| GET | `/admin/content/drafts/{id}/versions` | Version history |
| POST | `/admin/content/drafts/{id}/versions/{version}/restore` | Restore a prior version |
| GET | `/admin/content/credits` | Credit balance + usage history + feature quota |
| GET | `/admin/content/brand-tone` | Get brand tone config |
| PUT | `/admin/content/brand-tone` | Set brand tone (voice, forbidden words, language, preferred terms) |

### 7.1 Generate Request

```json
{
  "type": "product_description",
  "targetIds": ["prod_01", "prod_02"],
  "regenerate": false
}
```

- `type`: `product_description` or `meta`. (`blog` returns `400` — no blog entity yet.)
- `targetIds`: 1–50 valid product ids in the tenant's catalog.
- `regenerate`: when `false`, existing active drafts for a target are reused (cached, no credit charged).

### 7.2 Generate Response

With `REDIS_URL` set, generation is queued (BullMQ) and returns `202`:

```json
{ "data": { "queued": true, "jobId": "job_01" } }
```

Without Redis (or when immediate results are preferred), it runs synchronously and returns `200`:

```json
{
  "data": {
    "drafts": [
      {
        "id": "draft_01",
        "type": "product_description",
        "status": "draft",
        "body": "A lightweight hydrating serum…",
        "metaTitle": null,
        "metaDescription": null,
        "llmModel": "gpt-4o",
        "promptSnapshot": { "productId": "prod_01", "type": "product_description", "regenerated": false }
      }
    ],
    "cached": 0
  }
}
```

Behavior:
- Each generated draft records a `content.generated` ledger entry (`-1` credit). Bulk generation reserves credits up front and refunds unused amounts on partial failure.
- Over the remaining quota returns `429`.
- `503` when no provider is configured (`OPENAI_API_KEY` unset).
- Drafts are **never auto-published**; publishing requires an explicit approve → publish flow.

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

> **Implemented (Phase 4).** Live endpoints live under the merchant admin router (`/admin/analytics/...`, bearer token + `owner`/`editor` role) and differ slightly from the target surface below: connections sync in one POST instead of per-provider paths, reports are `GET /reports/gsc | ga4 | ads` and the unified view is `GET /overview`. OAuth entry is `GET /oauth/:provider` (returns `{ url, configured }`); `POST /connections` accepts `{ provider, code?, accountId?, demo? }`. Without `GOOGLE_*` env vars the fetcher runs in stub/demo mode.

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/integrations` | Connected integrations + status → `GET /admin/analytics/connections` |
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
curl -X POST http://localhost:4000/api/v1/admin/content/generate \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "product_description",
    "targetIds": ["prod_01"],
    "regenerate": false
  }'

# → 200 sync: { "data": { "drafts": [...], "cached": 0 } }
# → 202 async (REDIS_URL set): { "data": { "queued": true, "jobId": "job_01" } }
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