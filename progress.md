# Progress — Address Research Chat Agent

Living tracker. Update checkboxes and Notes as work happens. See `PRD.md` for full spec and
`decisions.md` for the reasoning behind each call. Ticket numbers match GitHub issues in
`Vraj1234/property-research-agent`.

## Phase 0 — Research
- [x] Survey data providers, rule out Zillow/Redfin/Realtor.com scraping, confirm fire
      station/hydrant data sources, evaluate Parallel.ai
- [x] Stakeholder decisions: hybrid data strategy, internal scope, OpenAI, Next.js, MVP target
- Notes: Completed 2026-08-25. See `PRD.md` §5 for the field→source matrix.

## Phase 1 — PRD, prune pass, repo setup
- [x] Draft `PRD.md`
- [x] Pruning pass: deterministic pipeline instead of agentic tool loop, Regrid narrowed to
      owner-only fallback, unified "primary → Parallel.ai" fallback rule, recency-triggered
      cross-check instead of dual-provider disagreement, single geocoder
- [x] `git init`, GitHub repo created under `Vraj1234`
- [ ] Stakeholder sign-off on "# rooms" = bed/bath vs total rooms (still open)
- Notes:

## Ticket 1 — Repo & project scaffold + deploy pipeline ✅ CLOSED 2026-08-25
- [x] Next.js + TypeScript app scaffolded
- [x] `.env.example`, README with setup instructions
- [x] Vercel project connected, deploys on push to `main`
- Notes: Deployment sits behind Vercel's default Team auth wall — not a bug, actually
  matches the PRD's internal/single-user scope decision. URL cosmetics (team slug in the
  domain) deliberately left alone for now, revisit with a custom domain if this ever needs
  to look presentable to someone other than us — see decisions.md.

## Ticket 2 — Core pipeline skeleton
- [ ] Shared types for the per-field result contract (`{ field, value, source, confidence }`)
- [ ] `geocodeAddress()` — US Census Geocoder, hard-fail with clear error on miss
- [ ] `/api/research` route wired to an orchestrator stub (no providers yet, just plumbing)
- Notes:

## Ticket 3 — RentCast integration
- [ ] `getPropertyRecord()` — bed/bath, sqft, year built, tax, HVAC when present, last
      sale/listing date (needed for the recency-triggered cross-check in Ticket 4)
- [ ] Schema mapping + null handling tested against live responses
- Notes:

## Ticket 4 — Fallback & enrichment layer (Parallel.ai only — Regrid dropped, see decisions.md)
- [ ] `webResearchFallback()` — Parallel.ai, one reusable function covering every field:
  - [ ] null-fill mode (owner name, mortgagee, HVAC, any other null field) — use `core`
        processor tier for owner/mortgagee (harder lookups), `base` for HVAC
  - [ ] recency-triggered bed/bath/sqft cross-check (last sale/listing < ~2 yrs) — `base` tier
- Notes:

## Ticket 5 — Fire station & hydrant distance tools
- [ ] `nearestFireStation()` — HIFLD dataset bundled/cached + haversine
- [ ] `nearestFireHydrant()` — OSM Overpass `around:` query
- Notes:

## Ticket 6 — Chat UI + address parsing
- [ ] Chat interface (Next.js)
- [ ] OpenAI call to parse/normalize a free-text address from the user's message
- [ ] Structured result card component, renders directly from pipeline JSON (no LLM writes it)
- Notes:

## Ticket 7 — End-to-end wiring & follow-up Q&A
- [ ] Orchestrator calls all tools per the source matrix, assembles final result
- [ ] Honest "not found" state per field — no silent omission, no fabrication
- [ ] Follow-up question handling: OpenAI answers from already-fetched data, no re-fetching,
      no inventing facts not in the result set
- Notes:

## Ticket 8 — Manual QA, bug fixes, deploy polish
- [ ] Test against 5+ real addresses across different states
- [ ] Verify ≥80% field population rate holds in practice
- [ ] Spot-check fire hydrant/station distances against a map
- [ ] Final deploy, confirm no keys exposed client-side
- Notes:

## Phase 9 — v2 backlog (unchecked, deferred)
- [ ] Evaluate ATTOM Data upgrade for mortgage/lender completeness
- [ ] Public-launch compliance: permissible-purpose gating, consent, rate limiting, audit log
- [ ] Auth / multi-user accounts
- [ ] Caching layer for repeat lookups
- [ ] Multi-address / portfolio view
- Notes:
