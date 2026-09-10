# P3 — SEO Auditor

**Status: Complete**

| Field | Value |
|---|---|
| **Phase** | P3 — SEO Auditor |
| **Goal** | Automatic crawl + audits that surface a prioritized, fixable issue queue |
| **Estimate** | 10–14 person-days |
| **Actual** | ~8 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| DB schema | Done | `006_audit.sql`: audits, crawl_urls, audit_issues, seo_scores, issue_fixes |
| Crawl worker | Done | `crawler.ts`: fetch-based with robots.txt, sitemap seed, politeness delay, link checking |
| Audit worker | Done | `crawlWorker.ts`: BullMQ consumer with retry + exponential backoff |
| Issue detection rule engine | Done | `rules.ts`: 14 issue types across 5 categories (metadata, content, links, schema, indexability) |
| SEO score computation | Done | `rules.ts`: 0–100 weighted score with category breakdown |
| Fix queue + auto-fix | Done | `service.ts`: one-click fix for product metadata + image alt, dismiss for others |
| Audit admin UI | Done | `SEOView.tsx`: overview (score + history), audits (run new), fix queue (issues + urls) |
| Scheduling (BullMQ jobs) | Done | `crawlQueue.ts`: async queue with 3 retries + exponential backoff |
| Tests | Done | Unit: `crawler.test.ts`, `rules.test.ts`. Integration: `audit.integration.test.ts` (4 tests) |

## Implementation Details

### Crawler (`apps/api/src/audit/crawler.ts`)
- Fetch-based (not Playwright) for lighter resource usage
- Respects robots.txt with longest-prefix-match allow/disallow
- Sitemap.xml seeding for comprehensive URL discovery
- Politeness delay between requests (configurable, respects Crawl-delay)
- Broken link detection with budget limit
- HTML parsing: title, meta description, h1, canonical, indexability, images, JSON-LD, word count

### Issue Detection (`apps/api/src/audit/rules.ts`)
14 issue types across 5 categories:
- **metadata**: missing-title, meta-title-too-long/short, missing-meta-description, meta-description-too-long
- **content**: missing-h1, multiple-h1, thin-content, images-without-alt
- **links**: broken-links
- **schema**: missing-jsonld (product pages only)
- **indexability**: missing-canonical, non-indexable, non-https

Each issue has severity (high/medium/low), impact score (5-25), and recommended fix with actionable fields.

### Auto-Fix (`apps/api/src/modules/audit/service.ts`)
- Product metadata issues: applies recommended title/description from fix queue
- Image alt issues: sets product title as alt text on all images
- Records before/after in `issue_fixes` table
- Recomputes score after fix

### Admin UI (`apps/admin/src/views/SEOView.tsx`)
Three tabs:
1. **Overview**: Current score (0-100) with category breakdown, score history table
2. **Audits**: Run new crawl (name + depth), list past audits with status/progress
3. **Fix queue**: Filter by status (open/fixed/dismissed), one-click fix/dismiss, crawled URLs table

## Exit Criteria

- ✅ Running a crawl on demo store detects ≥ 15 real issues; fixing via queue raises score measurably
- ✅ Crawler respects robots.txt & rate limits; does not crash on 500-page store

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/admin/seo/audits` | Start or queue a new audit |
| GET | `/admin/seo/audits` | List audits (paginated) |
| GET | `/admin/seo/audits/:id` | Get audit detail + score + open issue count |
| GET | `/admin/seo/audits/:id/issues` | List issues (filter by status/severity) |
| GET | `/admin/seo/audits/:id/urls` | List crawled URLs |
| POST | `/admin/seo/audits/:auditId/issues/:issueId/fix` | Auto-fix an issue |
| POST | `/admin/seo/audits/:auditId/issues/:issueId/dismiss` | Dismiss an issue |
| GET | `/admin/seo/score` | Get latest score + history |