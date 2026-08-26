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
data that doesn't change often. **Superseded 2026-08-26 — see the Ticket 5 entry further
down: HIFLD Open was discontinued, this decision no longer holds.**

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

**2026-08-25 — Left the Vercel deployment URL as-is (includes the `asp-capria` team slug) rather than fixing it now.**
Cosmetic-only issue, fixable later via a custom domain or project transfer; not worth spending
time on before Tickets 2-8 are built. Also noted: the deployment sits behind Vercel's default
Team authentication wall, which happens to align with the PRD's internal/single-user scope —
convenient, not intentional, but no reason to remove it.

**2026-08-25 — Dropped Regrid entirely; owner-name fallback now goes to Parallel.ai like every other field.**
Discovered while researching per-query cost that Regrid's self-serve API is a $500–$2,000/mo
subscription, not pay-per-call — a bad trade for a fallback that only fires occasionally for
one field RentCast usually already has. Removing it also restores a fully uniform fallback
rule (every field: primary → Parallel.ai, no exceptions), which is simpler than what it
replaces. No accuracy floor was assumed to be crossed by this — if QA (Ticket 8) shows owner
lookups are unreliable via Parallel.ai, revisit then with real hit-rate data instead of
pre-paying for Regrid speculatively.

**2026-08-26 — RentCast's Property Records endpoint never returns mortgage/lender data at all; mortgagee excluded from `RentCastPropertyRecord` entirely rather than mapped as an always-null field.**
Confirmed against RentCast's own docs and the returned schema while building Ticket 3 — there's
no field for it, not even an empty one. Mortgagee stays out of `researchAddress`'s `fields`
array until Ticket 4 actually attempts it via Parallel.ai, consistent with the same rule applied
to fire station/hydrant distance (§ below) — a field only appears once some provider has
actually been tried for it.

**2026-08-26 — RentCast "no property record for this address" is treated as a normal, honest null, not an error — including on live-verified edge cases it left previously undocumented (HTTP 404 for a valid, geocodable address with no property data, alongside the documented HTTP 400 for an unparseable one and an empty-array HTTP 200).**
Live testing during Ticket 3 (350 Fifth Avenue, a real commercial building) surfaced the 404
case, which the public docs don't mention at all. Treating it as a failure would have
mislabeled a legitimate data gap as an upstream error and produced a misleading "lookup failed"
note instead of an honest "not found" — caught only by testing against live responses per the
ticket's own acceptance bar, not by reading docs alone.

**2026-08-26 — A RentCast failure degrades the response to honest not-found fields instead of failing the whole `/api/research` request.**
Geocoding already succeeded by the time RentCast is called; per PRD.md §8 ("no compromise on
UX," fail loudly and clearly but don't silently guess), a downstream provider outage shouldn't
turn a good geocode into a 500 for the whole request. The orchestrator catches RentCastError,
logs the real cause server-side, and marks the affected fields null with an explanatory note —
same shape as a genuine "no record found," just a different note.

**2026-08-26 — Parallel.ai fallback (Ticket 4): `base` tier by default for every field including mortgagee/owner, `core` only behind an opt-in `deepResearch` flag; the interactive "want a deeper check?" prompt itself is deferred to Ticket 6/7.**
Live-tested `core` tier for a single mortgagee lookup and it took ~3.5 minutes — since
mortgagee fires on nearly every query (RentCast almost never has it), defaulting to `core`
would make most requests take minutes, not seconds, directly against PRD.md §8. Stakeholder
call: default to `base` everywhere, add a `deepResearch` boolean (threaded through
`researchAddress` → `webResearchFallback` → `/api/research`'s request body) that swaps
mortgagee/owner to `core` when explicitly requested, and surface a `notices` array on
`ResearchResult` warning about the latency when it's on. Actually *asking* the user "want me to
double-check this?" mid-conversation needs a chat turn and follow-up logic that don't exist yet
(Ticket 6/7) — building that loop inside the deterministic pipeline now would also violate the
"no LLM decisions in the core pipeline" architecture (PRD.md §6). Ticket 4 ships the mechanism
(tier toggle + per-field confidence already in `FieldResult`); the prompt itself is explicitly
deferred, not dropped.

**2026-08-26 — `base`-tier Parallel.ai timeout settled at 90s, not tuned further upward, after live testing showed it varies a lot by question difficulty (HVAC ~13s, mortgagee exceeded even 120s on one address).**
Initially set at 60s from a single HVAC data point; too short for mortgagee, which got
wrongly logged as "failed" when it may well have finished given more time. Rather than keep
chasing an empirical ceiling (each retest costs real money and 1-2 minutes), settled on a
deliberate, bounded 90s: a field that can't resolve on `base` within that window is treated as
an honest "couldn't determine this quickly" — the same class of outcome as "not found" — not a
defect to eliminate by inflating the default timeout indefinitely. That gap is exactly what the
opt-in `deepResearch`/`core` path (5-minute allowance) exists to cover.

**2026-08-26 — Live-testing surfaced two real "how does the model say 'I don't know'" bugs that plain doc-reading wouldn't have caught, both fixed before shipping.** (1) Asked a *string* field to be left blank when unknown, Parallel.ai instead wrote a prose refusal ("Unknown—not identified in the available public records.") rather than an empty string or omitted key — fixed by instructing an explicit machine-readable sentinel (`"NOT_FOUND"`) in every string/array prompt and checking for it on the way back. (2) Asked for an *array* of strings, Parallel.ai wrapped that same sentinel in the array shape (`["NOT_FOUND"]`) instead of returning `[]` — a subtler dodge the first fix didn't catch; the not-found check now also treats an array whose entries are all just the sentinel as not-found. Numeric fields (yearBuilt, propertyTaxAmount, bed/bath/sqft) can't hold a string sentinel at all under a strict `type: number` schema, so they rely on the model omitting the key entirely when instructed to — not exhaustively live-verified beyond one real case (a genuine `$0` answer, not a true "unknown"), and forcing a typed field onto an LLM carries a real, documented risk of a plausible-looking guess instead of a clean abstention. Flagged for Ticket 8 QA to spot-check with more addresses, not solved perfectly here.

**2026-08-26 — Bed/bath/sqft null-fill and cross-check share one combined Parallel.ai call, and each of the two fields decides independently whether it needs that call's answer.**
PRD.md §5 already treats "bed/bath/sqft cross-check" as one trigger, not three separate calls
— extended that to null-fill too, since asking for all three in one shot is no more expensive
than asking for one. A field is touched by the result only if *that field* is null (null-fill)
or has a value flagged by a recent sale/listing (cross-check) — e.g. bed/bath can be null-filled
while sqft is independently cross-checked in the very same call, without either mode leaking
into a field that didn't need it.

**2026-08-26 — Cross-check merge rule: override RentCast's bed/bath/sqft value only when Parallel.ai actually disagrees with it; leave it untouched if they agree or the cross-check call fails.**
A cross-check that silently confirms RentCast doesn't need to bother anyone; only a genuine
discrepancy is worth surfacing, with a note naming RentCast's original figure. A failed
cross-check attempt must never erase a real structured value — the field just keeps its
existing RentCast-sourced result, same principle as a RentCast provider outage not being
allowed to take down fields it never even touched.

**2026-08-26 — A RentCast failure (not just "no record") now also gets a full Parallel.ai fallback attempt, not just an honest null.**
A real resiliency improvement over Ticket 3 alone: previously a RentCast 500 marked all 6
fields null with no further attempt. Ticket 4's fallback layer runs unconditionally on
whatever `baseFields` the orchestrator hands it, so a transient RentCast outage no longer
forecloses Parallel.ai's chance to still answer owner/mortgagee/HVAC/etc. via its own
independent web research.

**2026-08-26 — Test convention: `afterEach` must call both `vi.restoreAllMocks()` and `vi.clearAllMocks()`, not just the former.**
Found while writing Ticket 4's orchestrator tests: `vi.restoreAllMocks()` resets a module-level
`vi.fn()` mock's *implementation* between tests but does not clear its recorded `.mock.calls`
history, so later tests silently saw earlier tests' calls (a `not.toHaveBeenCalled()` assertion
failed because of a call 3 tests earlier). Both files that mock module-level functions
(`orchestrator.test.ts`, `webResearchFallback.test.ts`) now call both in `afterEach` — apply the
same pair in any future test file that does the same kind of module mocking.

**2026-08-26 — HIFLD Open (the fire station data source PRD.md §5 specified) was discontinued by DHS on 2025-08-25; switched fire stations to OSM Overpass, the same API already planned for hydrants.**
Discovered while starting Ticket 5 — the old `hifld-geoplatform.opendata.arcgis.com` portal
404s outright ("Domain record(s) not found"), and DHS confirms the public portal was shut down
exactly a year before this ticket. A community Parquet archive exists (source.coop/seerai/hifld)
but is a frozen snapshot that only gets staler over time and would've added a new dependency
(a Parquet reader) just to bundle a static file — a worse trade than the original "free, no
dependency" appeal of HIFLD. Live-tested OSM Overpass's `amenity=fire_station` coverage before
committing to it: 0 stations within 8km of a real suburban test address, 6 within 20km — real,
but genuinely patchier than fire hydrants. Stakeholder chose Overpass anyway over bundling the
Parquet archive or hunting for another live official mirror, accepting the coverage gap as a
documented limitation — the same trade already made for hydrants. Fire station search radius
set to 25km to accommodate that observed sparsity; hydrants stay at 3km given their much higher
expected density in developed areas.

**2026-08-26 — Overpass API calls need explicit Accept/Accept-Encoding/Accept-Language/Sec-Fetch-Mode/User-Agent headers; Node's fetch defaults get HTTP 406 from this endpoint every time.**
Live-tested and reproduced reliably: the identical query via `curl` or Node's raw `https`
module returned 200, but Node's `fetch` (undici) — with its automatically-added header set —
got HTTP 406 ("Not Acceptable") from overpass-api.de's Apache front end on every attempt.
Bisected by overriding each auto-added header individually (none alone fixed it) and then all
five together (fixed it twice, consistently) — reads as the WAF fingerprinting undici's
default header combination as bot-like, not any single header. `queryNearbyNodes()` now sets
conventional values for all five explicitly. Also hit Overpass's fair-use rate limiting
firsthand from the volume of debugging requests this took (all round-robin mirror IPs started
timing out) — a live demonstration of the exact risk PRD.md §9 already flags, not a new one.
