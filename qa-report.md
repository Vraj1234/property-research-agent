# Ticket 8 — Manual QA Report

**Date:** 2026-08-27
**Scope:** 5 real addresses across 5 states, run through the live `/api/research` endpoint
(default settings, `deepResearch: false`). Full JSON responses saved under
`/tmp/ticket8-qa/addr{1..5}.json` for this session (not committed — regenerate by re-running
the commands below against a running `npm run dev`).

## Test set

Chose a mix of a residential address already used throughout this project's testing (no reason
to pull new private individuals' data into a QA pass) plus commercial/landmark addresses for
geographic + property-type diversity, since those exercise the "RentCast has nothing, full
Parallel.ai fallback" path that residential addresses mostly don't:

| # | Address | State | Type |
|---|---|---|---|
| 1 | 5500 Grand Lake Dr, San Antonio, TX 78244 | TX | Residential (RentCast-rich) |
| 2 | 1600 Pennsylvania Ave NW, Washington, DC 20500 | DC | Government (RentCast-sparse) |
| 3 | 350 Fifth Avenue, New York, NY 10118 (Empire State Building) | NY | Commercial (no RentCast record) |
| 4 | 400 Broad St, Seattle, WA 98109 (Space Needle) | WA | Landmark (no RentCast record) |
| 5 | 233 S Wacker Dr, Chicago, IL 60606 (Willis Tower) | IL | Commercial (no RentCast record) |

## Results

| # | Fields found | % (of 9) | Response time | Notes |
|---|---|---|---|---|
| 1 | 6/9 | 67% | 24.0s | All 6 core fields from RentCast directly |
| 2 | 6/9 | 67% | 19.4s | Mixed RentCast + Parallel.ai null-fills |
| 3 | 6/9 | 67% | 98.6s | No RentCast record — all 6 core fields from Parallel.ai |
| 4 | 5/9 | 56% | 54.1s | No RentCast record; HVAC null-fill also missed |
| 5 | 7/9 | 78% | 71.4s | No RentCast record; only address with mortgagee found |

**Overall (raw, all 9 fields, n=5): 30/45 = 66.7%** — below the PRD §8 target of 80%.

### The 80% target is not currently achievable, and it's not a code defect

Every single one of the 5 runs shows **both distance fields failing identically**:
`"OpenStreetMap Overpass lookup failed: Could not reach the OpenStreetMap Overpass API."` This
is the Overpass rate-limit/block documented in decisions.md (2026-08-26, 2026-08-27) —
this project's own cumulative debugging traffic across Tickets 5-7 got this network blocked by
Overpass's public instance. With 2 of 9 fields externally unavailable, **77.8% is the
mathematical ceiling** for every address tested this round, regardless of pipeline quality.

**Excluding the 2 Overpass-dependent fields, the remaining 7 (RentCast + Parallel.ai) scored
30/35 = 85.7%** — above the 80% target. That's the number that actually reflects this
pipeline's own performance today; the shortfall on the full 9-field number is entirely
attributable to the external outage, not the code built in Tickets 3-7.

**Action for whoever picks this up next:** re-run this same QA pass once Overpass access has
recovered (try from a different network if it's been more than a few days and it's still
blocked — see decisions.md for why hammering it further from this network isn't advisable) to
get a real, unblocked measurement of the full 9-field rate.

### Per-field findings

- **bedBathCount, squareFootage, yearBuilt, ownerName, propertyTaxAmount:** found for every
  address (100%, n=5) — either directly from RentCast or successfully null-filled by
  Parallel.ai when RentCast had nothing.
- **hvacType:** found 4/5 (80%) — missed only for the Space Needle (400 Broad St, Seattle),
  which makes sense: a public landmark doesn't have a residential HVAC system, so there's
  nothing real for either provider to find. Not a bug.
- **mortgagee:** found 1/5 (20%) — Willis Tower only. Directionally consistent with
  discussion.md's original "hardest field" framing (originally estimated ~90% miss rate on
  `base` tier), though n=5 is too small to treat this as a confirmed rate.
- **nearestFireStationDistance, nearestFireHydrantDistance:** found 0/5 (0%) — entirely
  blocked by the Overpass outage described above, not a reflection of real-world coverage.

### Spot-check fire hydrant/station distances against a map

**Blocked.** Zero real distance data was returned this round (see above), so there's nothing to
spot-check yet. Re-run once Overpass access recovers.

## Deploy / secrets check

- `npm run build` and `npm run lint`: clean.
- Grepped the built client bundle (`.next/static/`) for all three secret env var names
  (`OPENAI_API_KEY`, `RENTCAST_API_KEY`, `PARALLEL_API_KEY`) and for the first 15 characters of
  each actual key value from `.env` — none appear anywhere in client-side output. All three
  keys are read only from `src/lib/{addressParser,followUp,parallel,rentcast}.ts`, none of
  which are imported by any `"use client"` component.
- No `NEXT_PUBLIC_`-prefixed variables exist anywhere in the codebase (that prefix is the only
  thing that would leak a var to the client in Next.js).
- **Not verified this round:** the actual live Vercel deployment. It sits behind Vercel's
  default team auth wall (decisions.md, 2026-08-25) and no deployment URL is recorded in the
  repo, so this needs the user to check the Vercel dashboard directly and confirm the latest
  push (`8c134cf`, Ticket 7) built and deployed successfully, and that none of the three keys
  were accidentally configured as `NEXT_PUBLIC_*` in the Vercel project settings.

## Summary

| Ticket 8 item | Status |
|---|---|
| Test against 5+ real addresses across different states | ✅ Done (this report) |
| Verify ≥80% field population rate holds in practice | ⚠️ 85.7% on the 7 fields actually reachable this round; 66.7% including the externally-blocked distance fields. Re-verify full 9-field rate once Overpass recovers |
| Spot-check fire hydrant/station distances against a map | ❌ Blocked — no distance data returned this round |
| Final deploy, confirm no keys exposed client-side | ✅ No-leak check done locally; live Vercel deployment itself not independently verified — user should confirm |
