# BeautyAI — System Architecture

**Architecture Overview**

| Field | Value |
|---|---|
| **Product** | BeautyAI |
| **Doc Version** | 1.0 |
| **Status** | Draft |
| **Related** | PRD.md, TECH_SPEC.md, API.md, DATABASE_SCHEMA.md |
| **Last Updated** | 2026-09-05 |

---

## 1. Architectural Style

**Modular Monolith** API + **separate worker processes** + **SSR storefront**, orchestrated as containers. This balances fast iteration (single deployable) with scalable background processing (independent workers).

```
                         ┌───────────────────────────────────────────┐
                         │                CDN / Edge                 │
                         │   (Cloudflare/CloudFront: static + HTML)  │
                         └──────────────┬────────────────────────────┘
                                        │
              ┌─────────────────────────┴────────────────────────────┐
              │                                                      │
              ▼                                                      ▼
   ┌──────────────────────┐                           ┌──────────────────────────┐
   │   STOREFRONT (Astro) │── REST ──────────────────▶│       API SERVICE       │
   │  SSR pages + islands │                           │  Express + TypeScript   │
   └──────────────────────┘                           │  modules: auth, product, │
              ▲                                       │  order, content, audit,  │
              │                                       │  analytics, rec, billing │
   ┌──────────────────────┐                           └────────────┬─────────────┘
   │      BROWSER │       │                                        │
   │ Admin (React)│       │                                        │
   └──────────────┴───────┘                                        │
                                 Auth: JWT + refresh               │
                                 OAuth: Google APIs                │
                                 Stripe webhooks                   │
                                        │                          │
                                        ▼                          ▼
                              ┌──────────────────┐      ┌──────────────────────┐
                              │  REDIS           │      │  POSTGRESQL 16       │
                              │  cache + BullMQ  │      │  multi-tenant schema │
                              │  queues          │      └──────────────────────┘
                              └────────┬─────────┘
                                       │ (jobs)
                        ┌──────────────┴──────────────┬────────────────┐
                        ▼              ▼               ▼                ▼
              ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
              │ CONTENT WORKER│ │ CRAWL WORKER │ │ ANALYTICS    │ │ REC WORKER   │
              │  (LLM calls)  │ │  (Playwright│ │ SYNC WORKER  │ │ (recommend)  │
              │              │ │   +Lighthouse)│ │ (GSC/GA4/Ads)│ │              │
              └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                       │                │                │                │
                       ▼                ▼                ▼                ▼
              ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
              │   LLM API    │ │  TARGET SITES│ │ GOOGLE APIs  │ │   (DB reads) │
              │  (OpenAI...)  │ │  (storefront)│ │ GSC/GA4/Ads  │ │              │
              └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. Component Responsibilities

### 2.1 Frontend Surfaces

| Surface | Tech | Responsibilities |
|---|---|---|
| **Storefront** | Astro (SSR/SSG) + React islands | Product catalog, product page, collections, search, cart drawer, checkout, customer portal; SEO metadata; JSON-LD schema |
| **Admin Dashboard** | React SPA (Vite) | Product/order management, AI content studio, SEO auditor dashboard, analytics views, settings, billing |

### 2.2 API Service (Modular Monolith)

| Module | Responsibility |
|---|---|
| `auth` | Register/login, tenants & users, JWT issuance/refresh, RBAC middleware |
| `product` | Product/variant/collection CRUD, inventory, search, SEO metadata |
| `order` | Cart, checkout sessions, orders, fulfillment, refunds |
| `customer` | Customer accounts, addresses, order history |
| `content` | AI content generation (queues job), drafts, publishing, credit ledger |
| `audit` | Crawl/create/schedule, issue classification, SEO score, fix execution |
| `analytics` | GSC/GA4/Ads OAuth + connection mgmt, sync orchestration, report queries |
| `recommend` | Strategy definitions, serve recommendations, freshness jobs |
| `billing` | Stripe Checkout/Billing, plan quotas, webhook handler, invoice/credit ledger |
| `config` | Tenant settings, brand tone, feature flags, onboarding |

### 2.3 Worker Process(es)

One worker image, multiple job types handled by dedicated handlers; separate heavier `crawl-worker` image.

| Job | Handler | In/Out |
|---|---|---|
| `content.generate` | Content generation | prompt build → LLM → validated draft (DB) |
| `crawl.run` | Playwright crawl | pages → URLs/HTML meta → DB |
| `audit.lighthouse` | Lighthouse audit | URL list → per-page scores → DB |
| `analytics.sync` | Google data sync | GSC/GA4/Ads → normalized tables |
| `rec.refresh` | Recommendation recompute | co-occurrence/popularity → rec tables |
| `email.send` | Transactional email | order/notifications → SES/Resend |

---

## 3. Multi-Tenancy Model

- **Single shared schema** with `tenant_id` on every business table (chosen in ADR-002).
- **Tenant context**: derived from JWT (`tenant_id` claim) or storefront subdomain header.
- **Isolation enforcement**: repository layer appends `tenant_id = $1` to all queries; auth middleware blocks cross-tenant token use; workers assert tenant on write.
- **Storage isolation**: object storage paths prefixed per tenant; LLM prompts never leak cross-tenant data.

### Tenant Identity

| Field | Purpose |
|---|---|
| subdomain | `brand.customers.beautyai.com` or `brand.beautyai.app` |
| custom domain | optional branded CNAME |
| token | `Authorization: Bearer` |

---

## 4. Data Layer

PostgreSQL single logical DB; schema organised by domain:

```
public (
  tenants, users, roles, permissions, user_roles,
  products, variants, collections, product_collection, product_images,
  inventory, prices, product_seo, product_materials, tags,
  carts, cart_items, orders, order_items, order_events, shipments,
  customers, customer_addresses,
  content_drafts, content_versions, credit_ledger, brand_tones,
  audits, crawl_runs, crawl_urls, audit_issues, seo_scores, fixes,
  gsc_data, ga4_data, ads_data, analytics_syncs, analytics_connections,
  recommendations, rec_strategies,
  subscription, invoices, plans, feature_quotas,
  settings, feature_flags, jobs
)
```

Full DDL in `DATABASE_SCHEMA.md`.

---

## 5. Asynchronous Processing (BullMQ + Redis)

- **Queues**: content-gen (rate-limited by tenant credits), crawl (concurrency per tenant), lighthouse (throttled), analytics-sync (scheduled), rec-refresh (scheduled)
- **Reliability**: retries w/ exponential backoff; dead-letter queue on failure; idempotent job processing via unique keys
- **Scheduling**: `cron` via BullMQ repeatables
- **Poison messages**: moved to DLQ after N attempts; alert on backlog depth

---

## 6. External Integrations

| Integration | Type | Auth | MVP |
|---|---|---|---|
| Stripe Checkout | REST/webhooks | API key + signature | Yes |
| Stripe Billing | REST/webhooks | API key + signature | Yes |
| Google Search Console | REST (OAuth2) | OAuth refresh tokens | Yes |
| GA4 Analytics Data API | REST (OAuth2) | OAuth refresh tokens | Yes (P1) |
| Google Ads API | gRPC/REST (OAuth2) | OAuth refresh tokens | Yes (P1) |
| LLM Provider | REST | API key | Yes |
| Email provider | REST/SMTP | API key | Yes |
| Object storage | S3 API | Access keys | Yes |

**OAuth token store**: tokens encrypted (AES-256-GCM) with a KMS-managed key; refresh in background worker before expiry.

---

## 7. Storefront SEO Architecture

- Astro prerenders pages; CDN serves cached HTML; `stale-while-revalidate` for near-real-time updates
- Meta tags + Open Graph + Twitter cards rendered in head
- JSON-LD: `Product`, `Offer`, `AggregateRating`, `BreadcrumbList`, `Organization`
- canonical URLs; auto-generated sitemap.xml (`/sitemap.xml`); robots.txt
- ISR/ISG-style regeneration on content publish (webhook → storefront rebuild or on-demand revalidation)

---

## 8. Security Architecture

- **AuthN**: Argon2id for passwords; access token 15 min; refresh token 30 d rotated & revoked
- **RBAC**: roles owner / editor / viewer; per-domain permission checks in middleware
- **Tenancy**: token-bound tenant; 404 on cross-tenant id access (prevent enumeration)
- **AI safety**: no PII in prompts; output validation; fact guardrail (attributes only)
- **Secrets**: env-injected, encrypted at rest, masked in logs
- **Network**: TLS everywhere; VPC subnets per zone; egress only where needed

---

## 9. Observability

| Signal | Tooling | Notes |
|---|---|---|
| Logs | structured JSON → Loki/CloudWatch | `request_id`, `tenant_id`, `user_id` |
| Traces | OpenTelemetry | api → queue → worker spans |
| Metrics | Prometheus | RED, queue depth, LLM cost, crawl throughput |
| Errors | Sentry | tenant context, release tagging |
| Alerts | Alertmanager / Grafana | p95 latency, error rate, DLQ size |

---

## 10. Deployment Topology

### 10.1 Dev (single host, docker-compose)

```
api (3000) · worker (1) · crawl-worker · storefront (4321)
postgres:16 · redis:7 · minio (s3 dev) · admin smtp mock (Mailpit)
```

### 10.2 Production (K8s or managed VPS)

- `api` deployment ×N (HPA by CPU/RPS)
- `worker` deployment ×N (HPA by queue length)
- `crawl-worker` deployment (memory limits, min 2 replicas)
- Stateful: managed Postgres, managed Redis, S3-compatible object storage
- Ingress: TLS termination + CDN in front

---

## 11. Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| LLM provider down | Content blocked | Queue retries, fallback provider, graceful "try later" UX |
| Google API quota exhausted | Analytics stale | Backoff scheduling, cached last-good data, offline flag |
| Crawler overwhelmed | Store overload | Politeness delay, per-tenant rate limits, SLO |
| Redis down | Queues/cache off | Feature degradation (cache-bypass), BullMQ persistence (AOF) |
| Postgres down | Everything affected | Managed PG w/ HA; connection pooling (PgBouncer) |

---

*End of Architecture v1.0*