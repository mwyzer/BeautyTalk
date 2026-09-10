# P0 — Foundations

**Status: Complete**

| Field | Value |
|---|---|
| **Phase** | P0 — Foundations (Skeleton & Plumbing) |
| **Goal** | Monorepo, CI, database schema, auth, tenant isolation |
| **Estimate** | 8–10 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Monorepo (npm workspaces) | Done | `apps/api`, `apps/web`, `apps/admin`, `packages/*` |
| Dev environment | Done | docker-compose: postgres 16, redis 7, minio |
| DB schema + migrations | Done | Migrations 001–002 (extensions, tenants, users, auth, audit logs) |
| Seed script | Done | 2 demo tenants with sample catalog |
| Auth (register/login/refresh, JWT) | Done | argon2 hashing, token revocation, RBAC (owner/editor/viewer) |
| Tenant isolation | Done | `resolveTenant` middleware, scoped repositories, cross-tenant test |
| CI pipeline | Done | GitHub Actions: lint, typecheck, unit + integration tests, docker build |

## Exit Criteria

| Criteria | Status |
|---|---|
| `npm test` green on fresh clone | Passed |
| Demo user can log in and access only own tenant rows | Passed |
| Migrations run cleanly in CI | Passed |

## Notes

- Phases P0–P2 shared the same CI pipeline; no rework needed in later phases.