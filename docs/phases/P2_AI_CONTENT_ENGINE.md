# P2 — AI Content Engine

**Status: Complete** (2026-09-06)

| Field | Value |
|---|---|
| **Phase** | P2 — AI Content Engine |
| **Goal** | Store owners can generate SEO-ready content with brand-voice control |
| **Estimate** | 8–12 person-days |
| **Updated** | 2026-09-10 |
| **Source** | ROADMAP.md, PROGRESS.md |

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| LLM provider abstraction | Done | OpenAI (gpt-4o-mini/gpt-4o) + stub fallback |
| Content generation endpoint | Done | Single + bulk (1–50 products) |
| Draft lifecycle | Done | draft → edit → approve → publish |
| Version history + restore | Done | `content_versions` table |
| Brand tone configuration | Done | Voice, forbidden words, presets; admin UI |
| Credit ledger + quota | Done | 429 over plan limit |
| Content validation | Done | Meta ≤160, title ≤60, no attribute fabrication, no PII to LLM |
| Async queue mode | Done | BullMQ `content-generate`; sync fallback without Redis |
| Admin ContentView | Done | Generate, drafts, tone tabs |
| Tests | Done | Unit + integration |

## Exit Criteria

| Criteria | Status |
|---|---|
| Generate description + meta for a catalog in one operation | Passed |
| Published output live on storefront | Passed |
| Quota enforcement returns 429 over limit | Passed |
| Generated content passes validation rules | Passed |

## Notes

- Blog generation deferred — returns `400` (no blog entity yet).
- Live OpenAI key intentionally not wired (optional env): `/admin/content/generate` returns `503` until `OPENAI_API_KEY` is set.
- Async queue mode optional via `REDIS_URL`; generation runs synchronously without Redis.