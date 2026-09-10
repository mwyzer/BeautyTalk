# P5 — AI Product Recommendations

**Status: Not started** (schema only)

| Field | Value |
|---|---|
| **Phase** | P5 — AI Product Recommendations |
| **Goal** | Machine-assisted merchandising on the storefront |
| **Estimate** | 6–10 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| DB schema | Done | `008_recommendations.sql`: rec_strategies, product_recommendations |
| Event capture (product views, cart, orders) | — | Not implemented |
| Popularity + co-purchase computation | — | Not implemented |
| `rec-refresh` queue worker | — | Not implemented |
| Storefront widgets ("You May Also Like") | — | Not implemented |
| Personalized homepage ordering | — | Not implemented |
| Strategy configuration UI | — | Not implemented |
| Tests | — | Not implemented |

## Exit Criteria

- Related products render on storefront with plausible relevance; rules personalize homepage by behavior
- O(1) reads via precomputed table — no heavy query at request time

## Next Steps

1. Event capture (product views, add-to-cart, orders) into `customer_events`
2. Popularity + co-purchase computation (offline `rec-refresh` queue) into `product_recommendations`
3. "You May Also Like" + "Customers Also Bought" modules on product pages
4. Personalized homepage ordering (recent browsing/segment, v1 rules-based)
5. Strategy configuration UI (weights, enable/disable slots)
6. Storefront modules + tests