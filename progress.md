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
  hydrants. Hit a real bug: Node's `fetch` got HTTP 406 from Overpass while `curl` succeeded —
  attempted a fix (explicit Accept/Accept-Encoding/Accept-Language/Sec-Fetch-Mode/User-Agent
  headers), but **Ticket 7 found this fix is not reliable** — the same 406 recurred, and even
  `curl` itself became inconsistent, most likely because this project's own cumulative
  debugging traffic earned the IP a real fair-use penalty from Overpass (see decisions.md
  2026-08-27). The pipeline's honest-null-on-failure behavior is correct regardless and doesn't
  depend on this being fixed; treat Overpass reliability as unverified, revisit at Ticket 8 QA.
  14 new unit tests (51 total); `npm run build` clean; live-verified the (later-disproven) fix
  directly against the Overpass API at the time (full
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

## Ticket 7 — End-to-end wiring & follow-up Q&A ✅ CLOSED 2026-08-27
- [x] Orchestrator calls all tools per the source matrix, assembles final result — already true
      as of Tickets 3-5; no changes needed
- [x] Honest "not found" state per field — no silent omission, no fabrication — already true
      as of Tickets 3-5; no changes needed
- [x] Follow-up question handling: OpenAI answers from already-fetched data, no re-fetching,
      no inventing facts not in the result set
- Notes: `followUp.ts` — `answerFollowUp(question, result)`, grounded only in `result.fields`,
  gpt-5-nano (same model as address parsing; gpt-4o-mini is deprecated, see Ticket 6). Wired
  into `/api/research`: when the message doesn't contain a new address, and a `previousResult`
  is supplied, it's treated as a follow-up instead of a hard `NO_ADDRESS_FOUND` — no server-side
  session, so the client resends the last successful result each time (stateless per-request,
  matching the existing architecture). Response shape changed to a discriminated
  `ChatResponse = {type:"research"} | {type:"answer"}` envelope. Live-tested 3 real questions
  before wiring in: an answerable one (correct), a field never researched at all — lot size
  (honest "not in the data," not a guess), and a field researched but null — mortgagee (honest,
  cited the actual note) — all three correct on the first try. New `AgentAnswer` component,
  styled distinctly from both the result card and error states. 7 new unit tests (82 total);
  build/lint clean; verified live end-to-end in the browser (real lookup → real follow-up →
  correct grounded answer). Along the way, live-testing surfaced that Ticket 5's Overpass
  header fix isn't actually reliable and this project's own testing has rate-limited its own
  IP against Overpass — corrected in decisions.md and Ticket 5's notes above rather than left
  standing as an overclaimed fix.

## Ticket 8 — Manual QA, bug fixes, deploy polish ⚠️ CLOSED 2026-08-27 (partial — see notes)
- [x] Test against 5+ real addresses across different states — see qa-report.md
- [x] Verify ≥80% field population rate holds in practice — **85.7% on the 7 fields actually
      reachable this round; 66.7% on the full 9 including the externally-blocked distance
      fields.** Re-verify the true 9-field rate once Overpass access recovers
- [ ] Spot-check fire hydrant/station distances against a map — **blocked**, zero distance data
      returned this round (Overpass still down for this network as of this ticket)
- [x] Final deploy, confirm no keys exposed client-side — no-leak check done locally (clean);
      the live Vercel deployment itself needs the user to confirm directly, see notes
- Notes: Full findings in `qa-report.md`. Headline: every one of the 5 test addresses failed
  both distance fields with the identical Overpass connectivity error documented in Tickets 5/7
  — this network is still blocked by Overpass's public instance from this project's own
  cumulative debugging traffic, confirmed with one final gentle check at the end of this ticket
  (still `ETIMEDOUT`). That caps the *achievable* 9-field rate at 77.8% regardless of pipeline
  quality — not a code defect. Isolating the 7 fields RentCast/Parallel.ai actually control
  (30/35 = 85.7%) shows the pipeline itself is performing above the PRD §8 target; the shortfall
  is entirely the external outage. mortgagee found 1/5 (Willis Tower) — directionally
  consistent with it being the hardest field, updated discussion.md's hit-rate note accordingly.
  Deploy verification is genuinely incomplete: the Vercel deployment sits behind the team's own
  auth wall with no URL on record in this repo, so I cannot check it myself — asked the user to
  confirm the latest push (`8c134cf`) deployed cleanly and that no key is misconfigured as
  `NEXT_PUBLIC_*` on Vercel's side. Marking this ticket "closed" reflects that everything
  checkable from this side has been checked and reported honestly, not that all four items are
  fully green — the map spot-check and live-deploy confirmation are real open items for
  whoever picks this up next once Overpass recovers and the user has checked Vercel.

## Ticket 9 — Progressive field-streaming UX ✅ CLOSED 2026-08-27
- [x] `/api/research` streams each of the 9 fields to the client via Server-Sent Events as it
      individually resolves, instead of one JSON response after all 9 are done
- [x] Result card shows all 9 rows immediately in a "searching" state, each transitioning to
      found/not-found independently and out of order as the stream reports it
- [x] Per-row pending state names the real source being checked (RentCast/Parallel.ai/OpenStreetMap)
      rather than a generic spinner; live progress tally + elapsed-time-aware reassurance copy
- [x] `prefers-reduced-motion` respected (existing seal/reveal animations already handled this;
      extended to the new pending-seal and progress-bar transitions)
- Notes: Brainstormed 3 directions via the frontend-design skill (redacted case file, evidence
  pinboard, ledger ink reveal); user chose "Ledger Ink Reveal" for reusing the existing design
  system with lowest risk — see decisions.md. Backend: `webResearchFallback`/`distanceFields`
  gained an optional `onFieldResolved` callback fired the moment each already-independent
  `Promise.all` branch settles (no pipeline restructuring needed); orchestrator split into
  `researchFields` (streamable) + `researchAddress` (thin non-streaming wrapper, kept for tests).
  Route handler geocodes outside the stream (so a geocode miss/failure still returns a normal
  HTTP status, unchanged from Ticket 2) and only switches to `text/event-stream` once an address
  is confirmed; added `export const maxDuration = 300` since deep research's ~3.5 min ceiling
  (Ticket 4) was never actually covered by a Vercel function timeout before this. Frontend: new
  `LiveField`/`liveField.ts` model (pending vs. resolved, no provisional in-between values —
  PRD.md §8's "never a guess" bar applies to a half-finished UI too), a small `sseClient.ts`
  reader (native `fetch`/`ReadableStream`, no new dependency — `EventSource` can't do POST),
  `ResultCard`/`FieldRow` rewritten to render both the live-streaming and settled states through
  the same markup. 22 new unit tests (104 total); `npm run build`, lint, and `tsc --noEmit` all
  clean. Live-verified end-to-end in the browser against 350 Fifth Avenue (Empire State
  Building — chosen since Ticket 8's QA showed it has no RentCast record, so every field
  genuinely exercises the slower Parallel.ai path): watched all 9 rows go pending → resolve
  independently out of order over ~40s, progress bar and elapsed copy advance correctly, the
  stamp flip rust "Investigating" → ledger "Filed" exactly when the `done` event landed, and a
  follow-up question afterward still answered correctly grounded in the streamed result — no
  console errors. Confirmed Overpass is still blocked from this network (unchanged since
  Tickets 5/7/8, not a regression here) — both distance fields resolved to an honest "Not
  found" quickly, which usefully also proved fast-failing and slow-resolving fields interleave
  correctly in the UI.

