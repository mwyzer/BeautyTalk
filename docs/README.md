# BeautyAI — Documentation Index

**AI-Powered Beauty Commerce & SEO Intelligence Platform**

## Documents

| Doc | Purpose | Status |
|---|---|---|
| [PRD.md](./PRD.md) | Product requirements: vision, scope, features, personas, KPIs, risks | Draft v1.0 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, component responsibilities, data flows, deployment | Draft v1.0 |
| [TECH_SPEC.md](./TECH_SPEC.md) | Technology stack, modules, key technical decisions, testing strategy | Draft v1.0 |
| [API.md](./API.md) | REST API reference: endpoints, contracts, errors, examples | Draft v1.0 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | PostgreSQL physical model: DDL, indexes, enums, retention | Draft v1.0 |
| [PROGRESS.md](./PROGRESS.md) | Overall status + index of per-phase files in [phases/](./phases/) | P0–P2 Complete |
| [ROADMAP.md](./ROADMAP.md) | Phased build plan P0–P6 with exit criteria and dependencies | P0–P2 Complete |
| [ADRs.md](./ADRs.md) | Architecture decision records (modular monolith, tenancy, storefront, etc.) | Draft v1.0 |

## Reading Order

1. **PRD.md** — the "why" and "what"
2. **PROGRESS.md** — where each phase stands today
3. **ROADMAP.md** — the "when/how we sequence"
4. **ARCHITECTURE.md** — high-level "how"
5. **TECH_SPEC.md** — deep-dive "how"
6. **API.md** + **DATABASE_SCHEMA.md** — the contracts
7. **ADRs.md** — rationale behind key decisions

## Where to Start Building

Begin with **Phase 0 (Foundations)** in ROADMAP.md — monorepo, CI, data model, and tenant-isolated auth. **Phase 1 (Commerce Core)** is complete: catalog/admin/storefront, cart drawer, Stripe checkout (degrades to 503 until keys are set), webhook → orders, customer accounts, sitemap/JSON-LD. **Phase 2 (AI Content Engine)** is complete: `ContentProvider` abstraction, single/bulk generation (sync or BullMQ async), draft lifecycle (edit/approve/publish/reject), version history + restore, brand-tone config, credit ledger + quota enforcement, content validation, stub-provider tests, and an admin UI.

**Quickstart:** `npm run db:reset` (seeds `demo@glow.co / Password123!`), `npm run dev` starts API (:4000), storefront (:4321), and admin (:5173). Storefront and customer endpoints resolve the store via the `X-Tenant-Slug` header. Optional: set `OPENAI_API_KEY` for real generation and `REDIS_URL` (see `docker-compose.yml`) for async queue mode.

---

*BeautyAI · Documentation Suite v1.0 · 2026-09-06*