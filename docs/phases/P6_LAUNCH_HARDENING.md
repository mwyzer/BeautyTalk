# P6 — Launch & Hardening

**Status: Partial** (billing schema only)

| Field | Value |
|---|---|
| **Phase** | P6 — Launch & Hardening |
| **Goal** | Monetization, onboarding, and production readiness |
| **Estimate** | 10–14 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| DB schema + seed plans | Done | `009_billing.sql`: plans (Starter/Growth/Scale), subscriptions, feature_quotas; seed 3 plans |
| Stripe Billing (subscriptions) | — | No subscription checkout, portal, or invoice/subscription webhook handlers |
| Onboarding flow | — | Only auto-create tenant at registration; no guided setup |
| Observability (OTel, Sentry, Prometheus) | — | Not implemented; console logging only |
| Security pass (rate limiting, audit trail) | — | Partial: helmet, cors, argon2, audit log repo exist; no rate limiting middleware |
| Load/perf testing | — | Not implemented |
| Disaster recovery runbook | — | Not implemented |
| Beta program | — | Not implemented |

## Exit Criteria

- New brand can onboard to live sales in under 3 days; billing + quotas work through Stripe test mode
- 99.9% design achieved; alerting covers p95, error rate, queue backlog

## Next Steps

1. Stripe Billing: plans, subscription checkout, portal, webhooks, quota enforcement end-to-end
2. Onboarding flow: create store → connect domain → set brand tone → connect Google → first crawl
3. Observability: structured logs, OpenTelemetry traces, Sentry, Prometheus alerts
4. Security pass: secrets audit, rate limiting, audit trail, migration review
5. Load/perf test, disaster recovery runbook, docs (API, operator)
6. Beta program → public launch with 10–20 design-partner brands