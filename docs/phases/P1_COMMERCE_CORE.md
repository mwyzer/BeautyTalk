# P1 — Commerce Core

**Status: Complete** (2026-09-06)

| Field | Value |
|---|---|
| **Phase** | P1 — Commerce Core (Storefront v1) |
| **Goal** | A tenant can sell products: catalog, cart, checkout, orders |
| **Estimate** | 12–16 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Product/variant/collection CRUD API | Done | Public + admin endpoints |
| Admin UI (products, orders, customers) | Done | `apps/admin` views |
| Storefront (product, collection, search) | Done | Astro SSR |
| Cart + CartDrawer | Done | Cookie-based anonymous cart |
| Stripe Checkout + webhooks | Done | Degrades to 503 without keys |
| Order management | Done | List, status, fulfill, cancel, refund |
| Customer accounts | Done | Register, login, addresses, order history |
| SEO metadata (product level) | Done | Title, description, canonical |
| Sitemap + JSON-LD + robots.txt | Done | Auto-generated per store |
| Integration tests | Done | 14 commerce tests (42 in the full integration suite) |

## Exit Criteria

| Criteria | Status |
|---|---|
| Shopper browses → cart → Stripe checkout → order visible in admin | Deferred (requires Stripe keys) |
| Storefront builds with lighthouse-friendly SSR | Passed |
| Lighthouse ≥ 85 mobile | Pending in CI |

## Notes

- Stripe live credentials intentionally not wired — checkout degrades gracefully to `503` until `STRIPE_SECRET_KEY` + `CHECKOUT_*_URL` + `STRIPE_WEBHOOK_SECRET` are set.
- E2E flow is blocked on key configuration, everything else is covered by the 14 integration tests.