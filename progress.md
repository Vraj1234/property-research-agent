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

## Ticket 2 — Core pipeline skeleton ✅ CLOSED 2026-08-26
- [x] Shared types for the per-field result contract (`{ field, value, source, confidence }`)
- [x] `geocodeAddress()` — US Census Geocoder, hard-fail with clear error on miss
- [x] `/api/research` route wired to an orchestrator stub (no providers yet, just plumbing)
- Notes: 4 unit tests on the geocoder (match, no-match, upstream HTTP error, network failure),
  `npm run build` clean. Verified end-to-end against the live Census API: valid address returns
  `200` with real lat/lon, garbage address returns `422 NO_MATCH`.

## Ticket 3 — RentCast integration ✅ CLOSED 2026-08-26
- [x] `getPropertyRecord()` — bed/bath, sqft, year built, tax, HVAC when present, last
      sale/listing date (needed for the recency-triggered cross-check in Ticket 4)
- [x] Schema mapping + null handling tested against live responses
- Notes: Mortgagee excluded — RentCast's Property Records endpoint never returns it at all
  (confirmed against live responses and docs), so it stays out of `fields` until Ticket 4
  sources it via Parallel.ai. Orchestrator wired: RentCast success → high/medium-confidence
  fields; no record (HTTP 400, 404, or empty-array 200 — all three confirmed live, only 400
  is documented) → honest null fields with a note; RentCast failure (5xx, network, bad key) →
  same honest-null shape with a different note, request still returns 200 since geocoding
  already succeeded. 13 new unit tests (7 RentCast, 6 orchestrator); `npm run build` clean;
  verified end-to-end against 3 live addresses (data-rich record, sparse record, no-record).

## Ticket 4 — Fallback & enrichment layer (Parallel.ai only — Regrid dropped, see decisions.md) ✅ CLOSED 2026-08-26
- [x] `webResearchFallback()` — Parallel.ai, one reusable function covering every field:
  - [x] null-fill mode (owner name, mortgagee, HVAC, yearBuilt, propertyTaxAmount, bed/bath/sqft)
  - [x] recency-triggered bed/bath/sqft cross-check (last sale/listing < ~2 yrs), combined into
        the same call as the bed/bath/sqft null-fill rather than a separate provider call
- Notes: **Deviated from the original `core`-for-owner/mortgagee plan** — live-tested `core`
  tier at ~3.5 min for one mortgagee lookup, which would make nearly every query take minutes
  (mortgagee fires almost always). Shipped `base` tier by default for everything, with an
  opt-in `deepResearch` flag (threaded through `researchAddress`/`/api/research`) that swaps
  mortgagee/owner to `core` when explicitly requested; `ResearchResult` gained a `notices`
  array to warn about the latency when it's on. The interactive "want a deeper check?" chat
  prompt itself needs Ticket 6/7's chat UI and follow-up logic — deferred, not dropped; see
  decisions.md. Also fixed two real "how does the model signal 'unknown'" bugs caught only by
  live testing (prose refusals instead of empty strings; `["NOT_FOUND"]` instead of `[]` for
  array fields) — see decisions.md for both. RentCast failures now also get a full fallback
  attempt (a resiliency improvement over Ticket 3 alone). 21 new unit tests (37 total);
  `npm run build` clean; verified end-to-end against 2 live addresses (full RentCast record
  with a real recency-triggered cross-check window, and a sparse record needing null-fills
  across owner/sqft/tax/mortgagee).

## Ticket 5 — Fire station & hydrant distance tools ✅ CLOSED 2026-08-26
- [x] `nearestFireStation()` — OSM Overpass `around:` query + haversine (**not** HIFLD — see
      decisions.md: HIFLD Open was discontinued by DHS in Aug 2025, discovered while starting
      this ticket)
- [x] `nearestFireHydrant()` — OSM Overpass `around:` query
- Notes: Both fields now share one Overpass client (`overpass.ts`) and a `distanceFields()`
  field-builder, run in parallel with the RentCast/Parallel.ai pipeline in the orchestrator
  since neither needs anything but the geocoded point. No fallback for either field per
  PRD.md §5 — a miss is an honest null with a coverage-gap note, same treatment as a genuine
  Overpass failure (different note). Radii: 25km for fire stations (live-tested sparser OSM
  coverage than expected — 0 stations within 8km of a real suburban address), 3km for
  hydrants. Hit and fixed a real bug: Node's `fetch` got HTTP 406 from Overpass on every call
  (its default headers look bot-like to Overpass's WAF) while `curl` succeeded — fixed by
  setting explicit Accept/Accept-Encoding/Accept-Language/Sec-Fetch-Mode/User-Agent headers.
  Also personally tripped Overpass's fair-use rate limiting from debugging volume — a live
  instance of the exact risk already logged in PRD.md §9. 14 new unit tests (51 total);
  `npm run build` clean; live-verified the fix directly against the Overpass API (full
  `/api/research` re-verification skipped this round to respect the rate limit cooldown and
  avoid further Parallel.ai spend — worth a quick manual spot-check before Ticket 6).

## Ticket 6 — Chat UI + address parsing ✅ CLOSED 2026-08-27
- [x] Chat interface (Next.js) — "Property Dossier" style direction, see decisions.md
- [x] OpenAI call to parse/normalize a free-text address from the user's message
      (`gpt-4o-mini` was deprecated — switched to `gpt-5-nano`, see decisions.md)
- [x] Structured result card component, renders directly from pipeline JSON (no LLM writes it)
- Notes: `/api/research` now takes `{ message, deepResearch? }` instead of a bare `address` —
  a raw address string is just the trivial case of a message to parse, so one endpoint/schema
  covers both. New `NO_ADDRESS_FOUND` (422) error code when OpenAI can't find an address in
  the message. Caught and fixed a real flexbox scroll bug live in the browser (tall content was
  being silently compressed to fit instead of triggering scroll — see decisions.md). 19 new
  unit tests (75 total); `npm run build` and lint clean; verified end-to-end live in the actual
  browser across 3 real exchanges: a bare-address message (full card, 6/9 fields, mortgagee/
  distance fields honestly null with notes), a non-address message (clean 422 error bubble),
  and multi-turn thread accumulation. Mobile breakpoint and light theme are implemented but not
  visually confirmed — a browser-automation tooling limitation this session, not a known bug;
  worth a quick manual check.

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
