# BeautyAI — Technical Design Specification

**Technical Design Document (TDD)**

| Field | Value |
|---|---|
| **Product** | BeautyAI |
| **Doc Version** | 1.0 |
| **Status** | Draft |
| **Related** | PRD.md, ARCHITECTURE.md, API.md, DATABASE_SCHEMA.md |
| **Last Updated** | 2026-09-05 |

---

## 1. Overview

This document specifies the technical approach for building BeautyAI: an AI-powered beauty commerce & SEO intelligence platform. It covers the technology stack, module responsibilities, key design decisions, integration contracts, and operational concerns.

The system is a **multi-tenant B2B SaaS** where each beauty brand is a tenant with its own store, whose storefront is served server-side-rendered for SEO while every management surface is interactive.

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Storefront framework** | **Astro** with React islands | Fast SSR/SSG, minimal JS, ideal for SEO-critical storefronts |
| **Admin/Dashboard frontend** | React (Vite), optionally within Astro | Rich interactivity: auditing, analytics charts, AI content editor |
| **Backend / API** | Node.js + Express.js + TypeScript | Existing PRD decision; rich ecosystem, shared language w/ frontend |
| **Database** | PostgreSQL 16 | Relational integrity, JSONB for flexible attributes, full-text search option |
| **Object storage** | S3-compatible (MinIO for dev, AWS S3/GCS for prod) | Product images, export artifacts |
| **Cache** | Redis | Session cache, job queue (BullMQ), rate limiting, API response cache |
| **Job queue** | BullMQ (Redis-based) | Crawl jobs, content generation, analytics syncs, recommendation refreshes |
| **Crawler** | Playwright | Headless browser for JS-rendered pages |
| **Performance audit** | Lighthouse (via Chrome DevTools Protocol) | Page-level metrics |
| **LLM** | OpenAI API (GPT-4o / GPT-4o-mini routing) | Content generation; swap-capable abstraction (Anthropic, etc.) |
| **Auth** | JWT + refresh tokens; OAuth2 for Google APIs | Stateless API auth |
| **Payments & billing** | Stripe (Checkout + Billing) | PCI handled externally |
| **Search** | PostgreSQL FTS + trigram extension (initial) | Keep infra lean; defer Elasticsearch/Meilisearch until needed |
| **Observability** | OpenTelemetry + Prometheus + Grafana, Sentry | Logs, metrics, traces, errors |
| **Infra** | Docker + docker-compose (dev), K8s or VPS (prod) | Simple, reproducible |

---

## 3. Module Breakdown

### 3.1 Storefront Service (Astro)

- Serves product pages, collection pages, homepage, search results
- SSR for SEO-critical routes; static generation for marketing pages
- React islands for cart drawer, recommenders, quick-view
- Serves meta tags, JSON-LD schema (Product, Offer, Breadcrumb)
- Reads from API (REST) via a BFF pattern or directly

### 3.2 Core API Service (Express + TypeScript)

Single Node.js service (modular monolith) that grows into a service per domain as needed.

#### Domains

| Module | Responsibility |
|---|---|
| **auth** | Tenant + user auth, JWT issuance/refresh, RBAC |
| **products** | Product/variant/collection CRUD, inventory |
| **orders** | Cart, checkout sessions, orders, fulfillment |
| **customers** | Customer accounts, addresses, order history |
| **content** | AI content generation orchestration, drafts, publishing, credits |
| **audit** | Crawl orchestration, issue detection, SEO score, fixes |
| **analytics** | GSC/GA4/Ads OAuth, data sync, aggregated reports |
| **recommendations** | Recommendation strategies, rendering endpoints |
| **billing** | Plan quotas, Stripe webhooks, credits ledger |
| **tenancy** | Store configuration, brand tone, onboarding |

### 3.3 Worker Service (BullMQ consumers)

Separate process(es) consuming from Redis queues:

| Queue | Consumer | Purpose |
|---|---|---|
| `content-gen` | LLM worker | Generates content, retries, cost tracking |
| `crawl` | Crawl worker | Runs Playwright crawls, stores results |
| `lighthouse` | Audit worker | Runs Lighthouse per URL, stores scores |
| `analytics-sync` | Sync worker | Fetches GSC/GA4/Ads data on schedule |
| `recommend-refresh` | Rec worker | Recomputes recommendations |

### 3.4 Admin/Dashboard Frontend (React)

- SEO dashboard (score trends, fix queue)
- Content studio (generation, editing, publishing)
- Analytics view (GSC/GA4/Ads)
- Product management
- Order management
- Store settings, plan/billing

---

## 4. Key Technical Decisions

### 4.1 Modular Monolith First

Start as a single Node.js/Express API with clear module boundaries, deployable as several services later. Rationale: faster iteration, simpler ops, shared auth/models; forum threats identified if cross-module coupling grows — enforce module boundaries via lint rules (`import/no-cycle`, folder-based rules).

Risks: team discipline. Mitigation: strict module imports, nx-style dependency graph checks, tests.

### 4.2 Astro for Storefront SEO

Astro pre-renders HTML by default → great Core Web Vitals and SEO out of the box. React islands hydrate only where needed. Alternative considered: Next.js (heavier JS by default, more complex). Verdict: Astro matches the "SEO-first, performance-first" PRD priority.

### 4.3 PostgreSQL as Primary Datastore

Relational integrity for orders/inventory, JSONB for flexible product attributes (skin type, ingredients, benefits). FTS + `pg_trgm` for search with typo tolerance. Redis secondary for cache/queues only.

### 4.4 LLM Provider Abstraction

Define a `ContentProvider` interface (generateProductDescription, generateMetaTags, generateBlog, etc.). Initial implementation: OpenAI. Provider selected per-call by content type (cheap/fast model for meta; better model for long-form). Region/config isolation keeps tenant prompts separate.

### 4.5 Tenant Isolation

- Every tenant row carries `tenant_id`; all queries enforce it (repository layer)
- Auth issues token with `tenant_id` claim; middleware rejects mismatches
- Storage prefixes: `s3://beautyai/<tenant_id>/...`
- Queue jobs carry `tenant_id` and workers assert ownership before writing
- Schema-level: single shared schema with `tenant_id` (chosen for simplicity) — revisit if enterprise isolation demands schema-per-tenant

### 4.6 Analytics Storage Model

Raw GSC/GA4/Ads data upserted into normalized tables keyed by `(tenant_id, date, dimension)`. Aggregations computed on read or via hourly rollups. Retention policy configurable (default 24 months). Avoids O(n) API pulls on every dashboard render.

---

## 5. Data Flows

### 5.1 Content Generation Flow

```
Admin (React) → POST /api/v1/content/generate
  → API validates credits & quota
  → enqueue content-gen job (BullMQ)
  → worker: build prompt (product attrs + brand tone + SEO rules)
  → worker: call LLM → parse → validate lengths → produce draft
  → API: persist draft (status=draft) → notify via websockets/poll
  → Admin editor reviews → PATCH /drafts/:id → publish
```

### 5.2 Crawl & Audit Flow

```
Admin (React) → POST /api/v1/audits/crawl
  → API: create crawl record (status=queued)
  → enqueue crawl job
  → worker: Playwright crawls sitemap/seed URLs (politeness delay)
  → results streamed to DB (crawl_urls table)
  → for each URL enqueue lighthouse job (throttled)
  → audit worker: Lighthouse per page → scores stored
  → analysis pass: classify issues → update fix queue
  → recompute SEO score → notify dashboard
```

### 5.3 Analytics Sync Flow

```
Scheduler (cron) → enqueue analytics-sync for due tenants
  → worker: OAuth refresh if needed → pull data from GSC/GA4/Ads
  → upsert normalized rows → update last_sync_at, mark stale
  → dashboard reads aggregated tables
```

---

## 6. API Contract Overview

Full endpoint definitions in `API.md`. Conventions:

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <JWT>`
- Tenant scoping via token
- Errors: RFC 7807 problem+json
- Content-Type: `application/json` (multipart for image upload)
- Rate limits: per-tenant (analytics pulls), per-user (generation)

---

## 7. Security

| Area | Approach |
|---|---|
| **AuthN** | Argon2id password hashing; JWT (15 min) + refresh token (30 days, rotated, revoked) |
| **RBAC** | Roles: owner, editor, viewer; permission matrix enforced in API middleware |
| **OAuth** | Google APIs via OAuth2; tokens encrypted at rest (AES-256-GCM with KMS-managed key) |
| **Secrets** | Never in code/logs; injected via env/secret manager; masked citations |
| **Tenancy** | Repository-layer tenant guard; integration tests assert cross-tenant access returns 404 (not 403) |
| **AI safety** | Prompt builder never includes customer PII; output validated against claim/fact list |
| **Rate limiting** | Redis sliding-window per user/tenant/IP |
| **PCI** | No card data storage — Stripe handles tokens; verify scope reduction |

---

## 8. Testing Strategy

| Layer | Tools | Coverage |
|---|---|---|
| Unit | Vitest | Domain logic, prompt building, validators |
| Integration | Vitest + supertest | API endpoints, tenant isolation, DB interactions |
| E2E | Playwright | Storefront flows (buy → checkout), admin flows |
| Crawler tests | Playwright fixtures | Robot behavior, issue detection accuracy |
| Contract tests | Pact (later) | Provider-consumer between API & frontend |
| CI | GitHub Actions | lint, typecheck, unit, integration on every PR; E2E nightly |

---

## 9. Observability

- **Logs**: structured JSON, `request_id`, `tenant_id`, `user_id`; centralized (Loki or CloudWatch)
- **Traces**: OpenTelemetry across API → queue → workers
- **Metrics**: RED for API (rate/errors/duration), job queue depth, LLM cost per request, crawl throughput
- **Errors**: Sentry with tenant context; daily digest to team
- **Alerting**: Prometheus + Alertmanager (p95 latency, error rate, queue backlog)

---

## 10. Environment & Config

| Env | Purpose | Notes |
|---|---|---|
| `dev` | Local dev with docker-compose | PG, Redis, MinIO, worker, API, Astro storefront |
| `staging` | Pre-prod | Mirrors prod, seeded synthetic data |
| `prod` | Production | Managed PG/Redis, object storage, load balancer |

Config via `.env` files (12-factor); secrets via environment; schema migrations via tool.

---

## 11. Deployment

### 11.1 Containers

| Service | Image | Scaling |
|---|---|---|
| `api` | Node API | Horizontal (stateless) |
| `worker` | Same image, worker entrypoint | Horizontal by queue |
| `storefront` | Astro SSR build | Horizontal behind CDN |
| `crawl-worker` | Heavy Playwright image | Dedicated, memory-limited |

### 11.2 CDN / Caching

- Storefront assets: `Cache-Control: public, max-age`, immutable for hashed assets
- API responses: Redis cache for dashboard aggregations (TTL 60s)
- CDN edge cache for storefront HTML (e.g., Cloudflare/CloudFront) with purge-on-publish

---

## 12. Cost & Resource Estimation (Draft)

| Item | Est. Monthly |
|---|---|
| API VM (2×4GB) | ~$60 |
| Postgres (managed) | ~$60 |
| Redis (managed) | ~$15 |
| Object storage + egress | ~$10 |
| Crawl workers (4×2GB) | ~$80 |
| LLM API | variable ($0.1–$0.5 per 1k requests) |
| Observability | ~$30 |
| **Total baseline** | **~$255–350/mo** |

---

## 13. Migration Path

- Skip migrations to framework before product-market fit validation
- Migration triggers:
  - Storefront: if SSR perf or DX constraints hit → consider Next.js
  - Search: if FTS insufficient → Meilisearch
  - Monolith → services: when autonomous teams / scaling boundaries form
  - Recommendations: swap rules-based → embeddings (after behavioral data accrues)

---

*End of Tech Spec v1.0*