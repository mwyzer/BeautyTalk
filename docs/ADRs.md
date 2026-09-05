# ADR-001 — Modular Monolith over Microservices

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** Architecture

## Context

BeautyAI is a solo-to-small-team project requiring commerce, AI content, SEO auditing, analytics, and recommendations — 6+ domains. Microservices would add operational overhead (deployments, service discovery, distributed tracing, DB-per-service) before the product-market fit is proven. Yet we know background jobs (crawl, content-gen, analytics sync) must scale independently.

## Decision

Build the backend as a **modular monolith**: one Node.js/Express + TypeScript deployable with strict module boundaries (`auth`, `products`, `orders`, `content`, `audit`, `analytics`, `rec`, `billing`). Heavy background work runs in the **same codebase but separate worker processes** consuming BullMQ queues.

## Consequences

**Positive**
- Single deployment, fast local iteration, shared auth/validation/test infra
- Same modules later extractable into services if needed
- Workers scale independently where it matters

**Negative**
- Requires discipline to keep module boundaries; cross-module coupling risk
- Single DB unless extraction happens later

**Trade-off accepted:** boundary enforcement via lint rules (`import/no-cycle`, module-folder rules) + domain tests. Extraction triggers: 2+ autonomous teams or a scale boundary (e.g., crawl saturation).

**Related:** TECH_SPEC §4.1, ARCHITECTURE §2.2

---

# ADR-002 — Shared Tenant Schema (single DB) over Schema-Per-Tenant

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** Architecture

## Context

BeautyAI must isolate tenant (brand) data. Options: (a) single shared schema with `tenant_id` on every row, (b) schema-per-tenant, (c) database-per-tenant. MVP is B2B for small brands; enterprise tenancy agnostic.

## Decision

Use **(a) shared schema + `tenant_id` column** on every business table, enforced at the repository layer, with auth middleware guaranteeing tenant context.

## Consequences

**Positive**
- One migration set, easier schema evolution, trivial cross-tenant aggregate queries
- Cheaper ops; scales to thousands of tenants on one cluster

**Negative**
- Cross-tenant leaks are a code discipline issue → mitigated by mandatory tenant guard in repositories + dedicated isolation integration tests (attempting cross-tenant reads must return 404)
- Import/unload for a single tenant is harder

**Re-evaluate if:** a single enterprise tenant demands hard isolation → schema-per-tenant extension path documented in TECH_SPEC §4.5.

---

# ADR-003 — Astro (SSR/SSG) Storefront over Next.js

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** Frontend

## Context

Storefront is SEO-critical and performance-critical (PRD NFR: Lighthouse ≥ 85 mobile). Candidates: Next.js (App Router), Astro, plain static + client. The storefront must render fast, pre-render marketing pages, hydrate small islands (cart drawer, recommender), and support per-tenant dynamic catalog pages.

## Decision

Use **Astro** for the storefront with framework components only where interactivity is required (React islands), calling the BeautyAI REST API.

## Consequences

**Positive**
- Zero-JS-by-default pages → excellent Core Web Vitals; native SSR/SSG + revalidation
- Islands pattern matches our low-interactivity storefront
- Same React skill set reused for admin

**Negative**
- Less mainstream than Next.js; server-rendered interactive patterns require care (esp. cart/customer portal) → cart state handled via drive-by islands + cookie/API
- Ecosystem smaller

**Re-evaluate if:** heavy client-side interactivity with route-level features dominates → move to Next.js; path documented in TECH_SPEC §13.

---

# ADR-004 — PostgreSQL as Primary Datastore + Redis for Cache/Queues

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** Backend

## Context

Data includes relational entities (products, variants, orders), flexible catalog attributes, analytics time-series, and queues. MongoDB considered for flexibility; Elasticsearch for search/analytics.

## Decision

- **PostgreSQL 16** as the single source of truth (relational integrity for orders/inventory; JSONB for flexible attributes; FTS + `pg_trgm` for typo-tolerant search)
- **Redis** for: sessions/cache, BullMQ queues, rate limiting

## Consequences

**Positive**
- One primary datastore → simpler ops, integrity, transactions (orders/cart)
- JSONB gives document flexibility where needed
- FTS adequate for MVP catalog scale

**Negative**
- Analytics time-series in PG require partitioning + retention jobs (documented DATABASE_SCHEMA §6)
- If search gets heavy (faceted on large catalogs), migrate to Meilisearch — trigger documented

---

# ADR-005 — Encrypted OAuth Tokens Stored Server-Side

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** Backend/Security

## Context

GSC, GA4, and Google Ads integrations need long-lived access via OAuth refresh tokens. Tokens are sensitive credentials that expire and must be refreshed proactively.

## Decision

Store provider credentials in `analytics_connections`, **encrypted with AES-256-GCM** under a KMS-managed key; never returned in API responses; auto-refresh in background worker before expiry; only metadata (status, last_sync_at) surfaced.

## Consequences

**Positive**
- Long-lived integrations with automatic refresh; no user re-consent churn
- Key rotation via KMS; tokens unusable from DB dump alone

**Negative**
- Adds key-management dependency; refresh failures must alert
- Google OAuth consent per tenant still required at connect time

---

# ADR-006 — AI Content via LLM Abstraction + Prompt Builder

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** AI/Content

## Context

Content generation must produce on-brand, SEO-valid, fact-safe output, and the LLM provider should be swappable. Also must control cost (meta vs long-form).

## Decision

- Define a **`ContentProvider` interface**; default implementation OpenAI plugin
- **Prompt builder** composes: product attributes (facts) + brand tone + SEO rules; **never PII**
- **Model routing**: cheap/fast model for meta fields; higher-quality model for descriptions/blog
- **Post-process validation**: length rules, no-claim fabrication check against attribute whitelist
- All output lands as editable **drafts** (never auto-publishes)

## Consequences

**Positive**
- Auditability & safety; provider-swap cheap; cost-controlled via routing + credits

**Negative**
- LLM calls are non-deterministic → version history + prompt snapshots for reproducibility
- Cost at scale managed by credit system & caching

---

# ADR-007 — Precomputed Recommendation Tables over Real-Time ML

**Status:** Accepted · **Date:** 2026-09-05 · **Owner:** AI/Content

## Context

Recommendations can be real-time ML embeddings or offline computed. MVP needs plausible merchandising ("You May Also Like", "Customers Also Bought") without heavy ML infra.

## Decision

V1 = **offline/rules-based precomputation**: popularity baseline + co-purchase (co-occurrence from orders) + content-based similarity (shared attributes/tags), written to `product_recommendations` on a schedule. Personalized homepage = rules (recent views/segment).

## Consequences

**Positive**
- O(1) reads at request time; no ML infra; deterministic, explainable ("reason" shown)
- Slow refresh acceptable at storefront scale

**Negative**
- Cold-start for new products (mitigated by popularity/content fallback)
- Re-evaluate when user behavioral data accrues → embeddings/ALS path (TECH_SPEC §13)

---

*End of ADR set v1.0*