# Decisions Log

Running log of product/engineering decisions with a one-line "why." Newest at the bottom.
Append to this file every time a real decision gets made — this is the audit trail for
"why did we do it this way" when reviewing the product later.

---

**2026-08-25 — Excluded Zillow, Redfin, and Realtor.com as data sources.**
All three prohibit automated scraping in their ToS and courts still treat that as an
enforceable breach-of-contract claim; not worth the legal exposure when the same facts are
available through licensed/public sources.

**2026-08-25 — Data provider strategy: Hybrid (RentCast + Regrid + Parallel.ai), not ATTOM, not AI-only.**
ATTOM is sales-gated and slow to onboard (~$499/yr+, custom quotes); pure AI-web-research
would be cheapest but too inconsistent for structured facts like sqft/year built. Hybrid gets
a fast, cheap MVP with a documented upgrade path to ATTOM if mortgage-field coverage matters.

**2026-08-25 — Fire station distance sourced from HIFLD (DHS/CISA), not a live API.**
Free, comprehensive (~53k stations), and static — no rate limits or uptime dependency for
data that doesn't change often.

**2026-08-25 — Fire hydrant distance sourced from OpenStreetMap Overpass API.**
Only free, queryable hydrant dataset available; accepted crowdsourced coverage gaps
(rural/under-mapped areas) as a documented limitation rather than blocking on a paid source.

**2026-08-25 — Geocoding via US Census Geocoder.**
Free, no API key, no rate-limit/cost concern for a low-volume internal tool — no reason to
pay for Google Geocoding at this stage.

**2026-08-25 — Scope: internal/single-user tool for now, not public-facing.**
Owner name + mortgagee looked up by address resembles a skip-trace tool; internal-only scope
defers permissible-purpose/consent/rate-limiting/legal work until it's actually needed,
without blocking MVP speed.

**2026-08-25 — LLM provider: OpenAI for the agent's tool-calling loop.**
Stakeholder preference — everything else (data providers, frontend stack) was decided on
merit, but the LLM choice was a direct instruction, not a tradeoff analysis.

**2026-08-25 — Frontend/stack: Next.js + TypeScript, deployed on Vercel.**
Matches the user's existing global web coding-style/testing/performance conventions and
gives fast, low-friction deploy for an MVP with no need for a custom backend yet.

**2026-08-25 — No auth, no database, stateless per-request lookups for v1.**
Internal single-user tool with no persistence requirement yet; adding either now would be
speculative work against YAGNI — revisit if caching or multi-user need shows up.

**2026-08-25 — Milestone target: scrappy MVP, not production-grade launch.**
Stakeholder chose speed-to-demo over completeness; hardening (auth, rate limiting, monitoring,
compliance) is explicitly deferred to the v2 backlog rather than gold-plated up front.

**2026-08-25 — Parallel.ai used only as a gap-filling fallback, not a primary data path.**
Keeps the core dataset on structured, licensed providers (more consistent/cheaper) and limits
Parallel.ai usage (cost + latency) to fields those providers reliably leave null, like HVAC
type and mortgagee.

**2026-08-25 — All provider API keys kept server-side only (Next.js API routes), never sent to the browser.**
Standard secret-handling practice; no reason to ever expose RentCast/Regrid/OpenAI/Parallel
keys client-side for a server-rendered chat flow.

**2026-08-25 — "# rooms" interpreted as bed/bath count, flagged as an open question rather than assumed silently.**
RentCast/Regrid expose bed/bath counts, not a raw total-room tally; logged as unresolved in
the PRD so it gets confirmed before Phase 3 instead of guessed wrong and shipped.

**2026-08-25 — Revised the Zillow/Redfin/Realtor exclusion: allow an indirect, narrow cross-check via Parallel.ai for bed/bath/sqft only, still no direct scraper.**
Challenged on whether excluding portals hurt data quality — research showed assessor-based
sources (RentCast/Regrid) can be stale for renovated homes since assessors log sqft/rooms from
permit filings, not measurements, while Zillow layers in MLS + owner-corrected data. That's a
real (if narrow) accuracy gap worth covering. Owner name/mortgagee stay untouched by
portals — confirmed those fields aren't reliably published there anyway (Redfin's version is
inconsistent and being retracted), so no benefit to including them for those two fields. Using
Parallel.ai's own infrastructure instead of building our own scraper keeps us out of the
ToS/anti-bot problem directly.

**2026-08-25 — Replaced the agentic OpenAI tool-calling loop with a deterministic pipeline; LLM used only for address parsing and follow-up Q&A.**
The field-sourcing logic is fully known ahead of time — nothing for an LLM to "decide" at
runtime. An agentic loop choosing tool order/skipping steps is pure non-determinism risk for
no functional gain, and directly conflicts with "no compromise on data accuracy": deterministic
code can't forget a fallback the way an LLM-driven loop could. Pruned per the "max
functionality, minimum complexity" directive.

**2026-08-25 — Narrowed Regrid to a single job: owner-name fallback only (dropped as a fallback for bed/bath/sqft/tax).**
RentCast + the new Parallel.ai null-fill rule already cover those fields adequately; keeping
Regrid wired into all of them added integration/mapping cost without a real accuracy gain.
Owner name is the one field where a structured parcel database genuinely beats a generic
Parallel.ai web search, so that's the one place Regrid stays.

**2026-08-25 — Standardized on one fallback rule ("primary source, then Parallel.ai if null") instead of a bespoke fallback chain per field.**
Simpler to implement as one reusable function than N different per-field fallback paths, and
fewer distinct code paths means fewer places a real bug could hide — directly serves both
"minimum complexity" and "no compromise on accuracy."

**2026-08-25 — Bed/bath/sqft portal cross-check now triggers on "sold/listed in the last ~2 years" instead of "RentCast and Regrid disagree."**
Needed a trigger that didn't require re-adding Regrid as a second opinion on these fields
(which would have undone the Regrid-narrowing decision above). Recency-of-sale is a cheap,
already-available signal for "this property may have changed since the assessor last measured
it," and keeps the safety net without the extra integration.

**2026-08-25 — Dropped Regrid Typeahead as a geocoding fallback; US Census Geocoder only, hard-fail on miss.**
A second geocoder for a rare edge case wasn't worth another integration at MVP scope; a clear
error on failure is honest and simple, matching the "no compromise on UX" bar (fail loudly and
clearly, don't silently guess) without adding a redundant provider.

**2026-08-25 — Initialized the repo under github.com/Vraj1234 as `property-research-agent`, switched active `gh` account from the machine's default (kparekh5) to Vraj1234 before creating anything.**
User specified that GitHub account explicitly; the machine had a different account active by
default, so this had to be switched deliberately to avoid creating the repo under the wrong
identity.
