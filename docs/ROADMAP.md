# BeautyAI — Development Roadmap & Phase Plan

**Phased Build Plan**

| Field | Value |
|---|---|
| **Product** | BeautyAI |
| **Doc Version** | 1.0 |
| **Status** | Draft |
| **Related** | PRD.md, TECH_SPEC.md, ARCHITECTURE.md, API.md, DATABASE_SCHEMA.md |
| **Last Updated** | 2026-09-05 |

---

## 1. Overview

BeautyAI is built in **7 phases**, each producing a shippable increment and ending with a milestone review. Phases are ordered by risk and dependency: foundations → commerce core → AI content → SEO audit → analytics → recommendations → launch hardening.

> **Note:** No fixed timeline per user decision. Each phase lists estimated effort (person-days) and exit criteria so the plan works for any pacing.

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6
Foundations ▶ Commerce ▶ AI Content ▶ SEO Audit ▶ Analytics ▶ Recommendations ▶ Launch
(monorepo,    (storefront +  (content engine, (crawler,      (GSC/GA4/Ads,  (rec engine,   (billing,
 auth, schema) orders)       brand tone)      lighthouse)    dashboard)     personalization) onboarding)
```

---

## 2. Phase Detail

### Phase 0 — Foundations (Skeleton & Plumbing)

**Goal:** Working monorepo, CI, database schema, auth, and tenant isolation. Everything else builds on this.

#### Deliverables
- Monorepo setup (npm workspaces): `apps/web` (Astro), `apps/admin` (React+Vite), `apps/api` (Express+TS), `packages/*` (shared types, config, validators)
- PostgreSQL + Redis + MinIO docker-compose dev environment
- Base schema + migrations tooling (all core tables: tenants, users, products, orders, analytics, content, audit)
- DB seed script (demo tenant with sample catalog)
- Auth: register/login/refresh, JWT, RBAC (owner/editor/viewer)
- Tenant isolation middleware + repository guard pattern + first cross-tenant test
- GitHub Actions: lint, typecheck, unit + integration test pipeline, docker build

#### Exit Criteria
- `npm test` green on a fresh clone; a demo user can log in and access only its tenant's rows
- Migrations run cleanly in CI

**Est: 8–10 person-days**

---

### Phase 1 — Commerce Core (Storefront v1)

**Goal:** A tenant can sell products: catalog, cart, checkout, orders.

#### Deliverables
- Product/variant/collection CRUD API + admin UI
- Product pages, collection pages, search, filters (SSR via Astro)
- Cart (cookie/anonymous) + cart drawer UI
- Checkout via Stripe (hosted Checkout), webhook → order creation
- Order management admin (list, status, fulfill, note, refund)
- Sitemap.xml + JSON-LD (Product/Offer/Breadcrumb) generation
- Customer accounts (register, addresses, order history)
- SEO metadata editing on products (title/description/canonical)

#### Exit Criteria
- E2E: shopper browses → adds to cart → completes Stripe checkout → order visible in admin
- Storefront passes Lighthouse ≥ 85 (mobile) perf on product page

**Est: 12–16 person-days**

---

### Phase 2 — AI Content Engine

**Goal:** Store owners can generate SEO-ready content for their catalog, with brand-voice control.

#### Deliverables
- `ContentProvider` abstraction (LLM) + prompt builder (product attrs + brand tone + SEO rules)
- Single + bulk generation endpoints with async jobs (BullMQ `content-gen`)
- Draft lifecycle: draft → edit → approve → publish (writes to product fields)
- Version history + restore
- Brand tone configuration (voice, forbidden words, presets) UI
- Credit ledger + quota enforcement per plan
- Content validation (meta ≤ 160, title ≤ 60, no fabrication of attributes)

#### Exit Criteria
- Generate description + meta for a catalog in one operation; published output live on storefront
- Quota enforcement returns 429 over limit; generated content passes validation rules

**Est: 8–12 person-days**

---

### Phase 3 — SEO Auditor

**Goal:** Automatic crawl + Lighthouse audits that surface a prioritized, fixable issue queue.

#### Deliverables
- Playwright crawl worker (`crawl` queue) with politeness, sitemap seed, robots.txt respect
- Lighthouse audit worker per URL (mobile + desktop)
- Issue detection rule engine (metadata, alt, schema, broken links, thin content, canonical, indexability)
- SEO score (0–100) with category breakdown + trend
- Fix queue (severity × traffic impact) + one-click auto-fix for generated metadata/alt/schema
- Audit history + scheduling (repeatable BullMQ jobs) + crawl config options

#### Exit Criteria
- Running a crawl on demo store detects ≥ 15 real issues; fixing via queue raises score measurably
- Crawler respects robots.txt & rate limits; does not crash on 500-page store

**Est: 10–14 person-days**

---

### Phase 4 — Marketing Analytics

**Goal:** Connect Google data and surface a unified marketing + SEO dashboard.

#### Deliverables
- OAuth 2.0 connections for GSC, GA4, Google Ads; encrypted token storage
- Sync workers (`analytics-sync` queue): pull, upsert normalized rows, incremental dates
- GSC report (queries/pages/positions/CTR), GA4 (traffic/conversions), Ads (spend/ROAS)
- Unified overview: KPI tiles, trend charts, date range filter, CSV export
- Sync status UI + retry/backoff handling; rate-limit & quota handling

#### Exit Criteria
- Fresh connection syncs real data within minutes; dashboard renders correlated SEO/paid/organic view
- Token expiry auto-refreshes; sync failures surface with clear errors

**Est: 10–14 person-days**

---

### Phase 5 — AI Product Recommendations

**Goal:** Machine-assisted merchandising on the storefront.

#### Deliverables
- Event capture (product views, add-to-cart, orders) into `customer_events`
- Popularity + co-purchase computation (offline, `rec-refresh` queue) into `product_recommendations`
- "You May Also Like" and "Customers Also Bought" modules on product pages
- Personalized homepage ordering (recent browsing/segment) — v1 rules-based
- Strategy configuration UI (weights, enable/disable slots)

#### Exit Criteria
- Related products render on storefront with plausible relevance; rules personalize homepage by behavior
- O(1) reads via precomputed table — no heavy query at request time

**Est: 6–10 person-days**

---

### Phase 6 — Launch & Hardening

**Goal:** Monetization, onboarding, and production readiness.

#### Deliverables
- Stripe Billing: plans (Starter/Growth/Scale), checkout, portal, webhooks, quota enforcement end-to-end
- Onboarding flow: create store → connect domain → set brand tone → connect Google → first crawl
- Observability: structured logs, OpenTelemetry traces, Sentry, Prometheus alerts
- Security pass: secrets audit, rate limiting, audit trail, migration review
- Load/perf test, disaster recovery runbook, docs (API, operator)
- Beta program → public launch with 10–20 design-partner brands

#### Exit Criteria
- New brand can onboard to live sales in under 3 days; billing + quotas work through Stripe test mode
- 99.9% design achieved; alerting covers p95, error rate, queue backlog

**Est: 10–14 person-days**

---

## 3. Milestone Checklist

| Phase | Deliverable | Done When |
|---|---|---|
| P0 | Foundations | Auth + tenant isolation + CI green |
| P1 | Commerce Core | Full purchase flow end-to-end |
| P2 | AI Content | Generation on catalog with review flow |
| P3 | SEO Auditor | Auto-issues + fixes raise score |
| P4 | Analytics | Real data dashboard, unified view |
| P5 | Recommendations | Storefront personalization live |
| P6 | Launch | Billing + onboarding + hardened |

---

## 4. Dependency Graph

```
P0 ─────┐
        ├──▶ P1 ──▶ P2 ──▶ P3 ──▶ P4 ──▶ P5 ──▶ P6
        └──▶ (P2 requires products + admin from P1)
P2 standalone once P1 done
P3 requires storefront (P1) to crawl + admin for UI
P4 requires tenant settings/onboarding scaffolding (P0/P1)
P5 requires product views/orders events (P1/P2)
P6 requires everything (billing touches quotas in P2)
```

### Parallelization Opportunities
- **P2 (Content)** can begin immediately after P1; **P3 (SEO)** crawler worker can be built in parallel with P2.
- **P4 (Analytics)** integrations can proceed alongside P3 (independent external APIs).
- **P5** depends on event capture which exists by P1.

Suggested teams of 2: Team A = Commerce + Content; Team B = SEO + Analytics; then merge for P5/P6.

---

## 5. Definition of Done (per phase)

1. All user stories / FRs for the phase implemented and tested (unit + integration)
2. API endpoints documented in `API.md`; schema reflected in `DATABASE_SCHEMA.md`
3. No open P0/P1 bugs; lint/typecheck/CI green
4. Manual QA pass on staging with seed data
5. Phase demo recorded + acceptance notes added to this doc

---

## 6. Testing & QA Gates

| Gate | Runs On | Required |
|---|---|---|
| Lint + typecheck | every PR | yes |
| Unit tests | every PR | yes |
| Integration tests | every PR | yes |
| E2E (Playwright) | nightly + pre-release | yes |
| Lighthouse perf gate | pre-release | storefront ≥85 mobile |
| Cross-tenant isolation test | every PR (security) | yes |

---

## 7. Risk Log (build-time)

| Risk | Phase | Mitigation |
|---|---|---|
| LLM provider flakiness/cost | P2 | Queue retries, credit system, model routing |
| Google API quota surprises | P4 | Backoff + caching + offline mode |
| Playwright crawl perf issues | P3 | Politeness delay, budget per tenant |
| Stripe webhook debugging complexity | P1/P6 | Local Stripe CLI tunneling, event replay |
| Astro SSR + dynamic storefront friction | P1 | Prototype dynamic routes early (spike day 1) |

---

## 8. Suggested Immediate Next Steps

1. **Validate stack** — 1-day spike: Astro + Express + TS monorepo with a live product page + API
2. **Lock the data model** — review `DATABASE_SCHEMA.md`, adjust for product attribute needs
3. **Set up CI** — repo, GitHub Actions, docker-compose dev env (Phase 0 outputs)
4. **Pick 5 design-partner brands** — onboard as beta users by Phase 6

---

*End of Roadmap v1.0*