# PRD — Address Research Chat Agent

**Status:** Draft v1 (MVP scope), pruned for build
**Owner:** vrajr@uw.edu
**Last updated:** 2026-08-25

## 1. Overview

A website with a chat interface. The user pastes in a US address; the agent researches it
across a small set of licensed/public data providers and an AI web-research fallback, and
returns a structured summary of the property — with a named source for every field.

**One-liner:** "Paste an address, get an instant, sourced property dossier."

## 2. Goals / Non-goals

### Goals (v1 / MVP)
- Accept a single US residential address via chat.
- Return: bed/bath count, square footage, year built, current owner name(s), mortgagee/lender
  (best-effort), heating/cooling type, property tax amount, distance to nearest fire station,
  distance to nearest fire hydrant.
- Every returned field is labeled with which source produced it.
- Works end-to-end for a real address in a normal chat-latency window (not batch/async).

### Non-goals (v1)
- No direct scraping/integration with Zillow, Redfin, or Realtor.com — accessed only
  indirectly through Parallel.ai as a narrow physical-characteristics cross-check (see §5, §9).
- No multi-user accounts, auth, or billing.
- No bulk/portfolio lookups (one address at a time).
- No mobile app — responsive web only.
- No historical price/valuation trend charts.
- No guarantee of mortgagee accuracy (documented limitation, not silently dropped).

## 3. Users & Context

Internal / single-user tool for now (confirmed with stakeholder). This materially simplifies
v1: no auth, no rate limiting, no consent/permissible-purpose flow, no audit logging.

**Important constraint carried forward, not solved now:** owner name + mortgagee looked up by
address is public-record data, but a tool that does this on demand resembles a skip-trace /
background-check product. If this ever moves from internal tool to something other people use,
it needs a permissible-purpose disclaimer, rate limiting/abuse prevention, and a legal review
pass before that expansion — tracked in the v2 backlog (§10), not required for this milestone.

## 4. User Flow

1. User opens the chat UI, types or pastes a US address.
2. Backend geocodes the address (lat/lon + normalized components).
3. Agent orchestrator calls the relevant data tools (see §6) — in parallel where possible.
4. Results are aggregated: a deterministic pipeline (not an LLM decision) resolves each field
   primary → fallback per the matrix below, and attaches a source label.
5. Agent replies in-chat with a structured card: each field, its value (or "not found"), and
   which source it came from.
6. User can ask natural-language follow-ups ("what's the lot size", "how old is the roof") —
   v1 does not need to guarantee these are answerable, but the agent should say so honestly
   rather than fabricate.

## 5. Field → Source Matrix

| Field | Primary source | Fallback | Notes / caveats |
|---|---|---|---|
| Address → lat/lon | US Census Geocoder (free, no key) | — (hard fail with a clear error) | A second geocoder for the rare failure case isn't worth the integration cost at MVP scope |
| Bed/bath count | RentCast Property Data API | Parallel.ai (null-fill), + Parallel.ai portal cross-check if property sold/listed in last ~2 yrs | "# rooms" interpreted as bed/bath count — **open question, confirm with stakeholder before/at MVP demo**. Cross-check trigger uses recency-of-sale as the "might be stale" signal (see §6), not a second structured provider |
| Square footage | RentCast | Parallel.ai (null-fill + recency-triggered cross-check, same rule as above) | Assessor-sourced sqft can be stale for renovated homes — see §6 "Portal cross-check" |
| Year built | RentCast | Parallel.ai (null-fill only) | Doesn't change post-construction, so no cross-check needed |
| Owner name(s) | RentCast owner-of-record | Regrid ownership (structured 2nd opinion), then Parallel.ai as last resort | Regrid's only job in this system is this one field — it's a parcel/ownership database, genuinely better suited to this than a general web search |
| Mortgagee / lender | RentCast (if populated) | Parallel.ai Task API (best-effort web research) | Weakest-coverage field at this budget tier. If accuracy here matters more than expected, upgrade path is ATTOM Data (see §10) |
| Heating / cooling type | RentCast structure data | Parallel.ai Task API | Most likely field to need the AI-research fallback — structured providers populate this inconsistently |
| Property tax amount | RentCast tax assessment | Parallel.ai (null-fill) | Dropped Regrid as a fallback here — RentCast coverage is already solid for tax, a second structured provider added cost without meaningfully improving hit rate |
| Distance to nearest fire station | HIFLD national fire station dataset (free, DHS/CISA, ~53k stations) + haversine calc from geocoded point | — | Static dataset, reliable, no live API dependency |
| Distance to nearest fire hydrant | OpenStreetMap Overpass API (`emergency=fire_hydrant`, `around:` radius query) | — | Crowdsourced — coverage gaps in rural/under-mapped areas are a known limitation, not a bug to fix |

**One fallback rule, not per-field bespoke logic:** every field above follows the same pattern
— call the primary source, and if it comes back null, call Parallel.ai. Owner name is the one
exception (gets a structured second opinion from Regrid first, since a parcel database beats
a web search for this specific fact). This uniformity is deliberate: one reusable
"try primary, then Parallel.ai" function handles most of the matrix instead of a different
fallback chain per field, which is less code and fewer places for a bug to hide.

**Zillow/Redfin/Realtor.com are not scraped directly — accessed only indirectly via Parallel.ai, and only for physical-characteristic cross-checks.** All three prohibit automated access
in their Terms of Use, and Zillow's only official API (Bridge Interactive) requires MLS
affiliation. Rather than build a scraper against that risk, we use Parallel.ai's own
web-research infrastructure (their product, their ToS relationship with the destination site)
as a targeted second opinion when RentCast/Regrid's bed/bath/sqft numbers look stale.

*Why a cross-check is worth having at all:* RentCast is ultimately built on county assessor +
deed records, and [assessor square footage/room counts are logged from permit filings, not
measurements](https://measurefloorplan.com/learn/county-assessor-square-footage-wrong) —
unpermitted renovations, finished basements, or added bedrooms never make it into the assessor
record. Zillow layers in MLS listing data (agent-verified at time of listing) and
user-submitted owner corrections on top of the same assessor base, so for a *recently
renovated or recently listed* property it can have a materially more current bed/bath/sqft
figure than assessor-only sources.

*How the trigger works (kept simple on purpose):* rather than requiring a second structured
provider to disagree with RentCast (which would mean paying for Regrid coverage on fields it
isn't otherwise used for), the trigger is a cheap signal already present in the RentCast
response — last sale/listing date within roughly the last 2 years. That's a reasonable proxy
for "this property may have changed since the assessor last measured it." For a typical
untouched property, this never fires and RentCast's number stands — the cross-check is a
safety net for a minority of lookups, not a primary path.

*Why owner name and mortgagee are excluded from this cross-check entirely:* confirmed these
aren't reliably there to find. Zillow and Realtor.com don't display owner/mortgage info at
all. Redfin has recently shown it on some listings, but only [county-specific, only on homes
sold in the last ~3 years that were previously Redfin-listed, and being retracted per-request
after a privacy backlash](https://discuss.privacyguides.net/t/psa-redfin-posting-owner-name-on-house-listings/32075) — not something to build a cross-check on. See §10 for the ATTOM
upgrade path if these two fields need better coverage.

## 6. Architecture

**Deliberately not an agentic tool-calling loop.** The field-sourcing logic is fully known
ahead of time (§5's matrix) — there's nothing for an LLM to "decide" about which tool to call
or in what order, and letting it improvise that would add non-determinism and hallucination
risk for zero functional benefit. That's a straight complexity-for-nothing trade, and directly
works against "no compromise on data accuracy": deterministic code cannot forget a fallback
step or misroute a field the way an LLM-driven tool loop could. So the core pipeline is plain,
testable TypeScript. The LLM is used only where natural language is actually the job:
parsing a free-text address out of a chat message, and answering conversational follow-ups
using the already-fetched structured data (never re-fetching, never inventing facts).

```
Browser (chat UI)
   │
   ▼
Next.js API route  /api/research
   │
   ├─ 1. OpenAI: parse/normalize a US address out of the user's chat message
   │
   ▼
   2. Deterministic orchestrator (plain TypeScript, no LLM in the loop)
   │
   ├─ geocodeAddress()        → US Census Geocoder
   ├─ getPropertyRecord()     → RentCast Property Data API (primary for 7 of 9 fields)
   ├─ getOwnerFallback()      → Regrid Parcel API (owner name only, if RentCast is null)
   ├─ nearestFireStation()    → HIFLD static dataset (bundled/cached) + haversine
   ├─ nearestFireHydrant()    → OpenStreetMap Overpass API
   └─ webResearchFallback()   → Parallel.ai Task API — one reusable function, called for
                                any field RentCast left null, plus a recency-triggered
                                bed/bath/sqft cross-check (see §5)
   │
   ▼
   3. Assemble structured result: { field, value, source, confidence } per field —
      pure data transformation, no LLM involved
   │
   ▼
Chat UI renders the structured card directly from that JSON (no LLM "writes" the card)
   │
   ▼
   4. OpenAI: only invoked again if the user asks a natural-language follow-up,
      answering from the already-fetched structured result
```

**Stack:** Next.js + TypeScript (frontend + API routes), OpenAI used narrowly for steps 1 and
4 above (not the core pipeline), hosted on Vercel. No database required for v1 — stateless
per-request lookups (add caching in v2 if latency/cost demands it).

**Security note:** all provider API keys (`OPENAI_API_KEY`, `RENTCAST_API_KEY`,
`REGRID_API_TOKEN`, `PARALLEL_API_KEY`) are server-side environment variables only, never
sent to or readable from the browser.

## 7. Config / Secrets Needed

| Key | Required for | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Agent orchestration | |
| `RENTCAST_API_KEY` | Property records | Free tier: 50 calls/mo |
| `REGRID_API_TOKEN` | Owner-name fallback only | Narrowed scope — see §5/§6 |
| `PARALLEL_API_KEY` | Gap-filling web research | Only called when structured data is missing — keep usage low by design |

No key needed for: US Census Geocoder, HIFLD dataset (static download, bundle/cache locally),
OpenStreetMap Overpass API.

## 8. Success Criteria (MVP)

- Given a valid, geocodable US residential address, the agent returns a response where at
  least 80% of the nine target fields are populated with a named source.
- Every populated field has an attributed source; every unpopulated field says so explicitly
  rather than omitting silently or guessing.
- A full request (chat message → structured card) completes in a reasonable chat-latency
  window (target: single-digit seconds under normal conditions; parallel tool calls where
  possible to avoid serial waterfalls).

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ToS/legal exposure from scraping Zillow/Redfin/Realtor.com | Never build a direct scraper; any access to these sites goes through Parallel.ai's own web-research product (their infrastructure, their ToS relationship), and only as a narrow cross-check for bed/bath/sqft — never for owner/mortgage |
| Owner/mortgage data is PII-sensitive | Internal-only scope for v1; v2 compliance work required before any external exposure |
| RentCast free-tier rate limits | Acceptable for internal/MVP usage volume; documented as a scaling concern for v2 |
| OSM fire hydrant coverage gaps | Documented as an inherent data-quality limitation, surfaced to the user rather than hidden |
| Mortgagee field hard to source cheaply | Documented; ATTOM Data flagged as the paid upgrade path if this field turns out to matter more in practice |
| Parallel.ai cost/latency if overused | Only invoked as a fallback for null fields, not as a primary path for every query |

## 10. v2 Backlog (explicitly out of scope for this milestone)

- Upgrade path to ATTOM Data for more complete mortgage/lender coverage.
- Public-launch compliance: permissible-purpose gating, consent flow, rate limiting, abuse
  prevention, audit logging, legal review.
- Auth / multi-user accounts.
- Caching layer for repeated address lookups (cost + latency optimization).
- Multi-address / portfolio view.
- Resolve the "# rooms" ambiguity definitively with the stakeholder (bed/bath vs total rooms).
