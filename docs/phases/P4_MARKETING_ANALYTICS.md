# P4 — Marketing Analytics

**Status: Complete** (verified 2026-09-10)

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
| DB schema | Done | `007_analytics.sql`: analytics_connections, analytics_syncs, gsc_data, ga4_data, ads_data |
| OAuth 2.0 flows (GSC, GA4, Ads) | Done | Google provider: auth URL, code exchange, offline refresh, account discovery (sites / accountSummaries / listAccessibleCustomers) |
| Encrypted token storage | Done | AES-256-GCM via `node:crypto`; key derived from `ANALYTICS_TOKEN_KEY` (falls back to `JWT_ACCESS_SECRET`) |
| Sync workers (analytics-sync queue) | Done | BullMQ `analytics-sync` queue + worker; degrades to inline sync without Redis |
| GSC report endpoints | Done | `/admin/analytics/reports/gsc` — queries × pages, clicks/impressions/CTR/position |
| GA4 report endpoints | Done | `/admin/analytics/reports/ga4` — source × medium traffic/conversions/revenue |
| Ads report endpoints | Done | `/admin/analytics/reports/ads` — campaign spend/clicks/ROAS |
| Unified dashboard | Done | Admin `Analytics` view: Overview KPIs + daily totals, Connections (demo/Google), Reports |
| Token refresh + error handling | Done | Refresh on expiry before pull; failed syncs recorded with error; demo/stub mode when Google not configured |
| Tests | Done | 4 unit (crypto) + 5 integration (connect/sync/reports/isolation/disconnect) |

## API Surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/analytics/oauth/:provider` | OAuth start — returns `{ url, configured }` |
| POST | `/admin/analytics/connections` | Connect `{ provider, code?, accountId?, demo? }` |
| GET | `/admin/analytics/connections` | List connections |
| DELETE | `/admin/analytics/connections/:provider` | Disconnect + purge that provider's data |
| POST | `/admin/analytics/syncs` | Sync `{ providers?, startDate?, endDate? }` — queued or inline |
| GET | `/admin/analytics/syncs` | Sync run history |
| GET | `/admin/analytics/reports/gsc\|ga4\|ads` | Provider reports for `startDate`..`endDate` |
| GET | `/admin/analytics/overview` | KPIs + daily series across GSC/GA4/Ads |

## Configuration

All optional — the dashboard runs in **demo mode** when unset (stub fetcher, deterministic data, encrypted stub tokens):

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `GOOGLE_ADS_DEVELOPER_TOKEN` (required for Ads pulls only)
- `ANALYTICS_TOKEN_KEY` (≥16 chars; falls back to `JWT_ACCESS_SECRET`)

## Exit Criteria

- Fresh connection syncs real data within minutes; dashboard renders correlated SEO/paid/organic view — **met** via incremental syncs (resumes from last date) + unified overview series
- Token expiry auto-refreshes; sync failures surface with clear errors — **met** (refresh-on-expiry, failed status + error message)

## Notes / Follow-ups

- Real Google end-to-end requires a configured OAuth client + redirect host; tests use the stub fetcher via DI.
- GA4 discovery reads `accountSummaries` (analytics.readonly); if the first property is unlisted, pass `accountId` explicitly.
- CSV export of report tables remains a follow-up.