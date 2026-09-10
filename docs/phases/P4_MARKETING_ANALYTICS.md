# P4 — Marketing Analytics

**Status: Not started** (schema only)

| Field | Value |
|---|---|
| **Phase** | P4 — Marketing Analytics |
| **Goal** | Connect Google data and surface a unified marketing + SEO dashboard |
| **Estimate** | 10–14 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| DB schema | Done | `007_analytics.sql`: analytics_connections, gsc_data, ga4_data, ads_data |
| OAuth 2.0 flows (GSC, GA4, Ads) | — | Not implemented |
| Sync workers (analytics-sync queue) | — | Not implemented |
| GSC report endpoints | — | Not implemented |
| GA4 report endpoints | — | Not implemented |
| Ads report endpoints | — | Not implemented |
| Unified dashboard | — | Not implemented |
| Token refresh + error handling | — | Not implemented |
| Tests | — | Not implemented |

## Exit Criteria

- Fresh connection syncs real data within minutes; dashboard renders correlated SEO/paid/organic view
- Token expiry auto-refreshes; sync failures surface with clear errors

## Next Steps

1. OAuth 2.0 connections for GSC, GA4, Google Ads with encrypted token storage
2. Sync workers (`analytics-sync` queue): pull, upsert normalized rows, incremental dates
3. GSC report (queries/pages/positions/CTR), GA4 (traffic/conversions), Ads (spend/ROAS) endpoints
4. Unified overview: KPI tiles, trend charts, date range filter, CSV export
5. Sync status UI + retry/backoff + rate-limit/quota handling
6. Admin dashboard pages + tests