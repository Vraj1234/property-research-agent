# Discussion — LLM Role, Parallel.ai Role, and Per-Query Cost

Prepared for presentation. Pairs with `PRD.md` (spec) and `decisions.md` (why each call was
made). This doc answers three questions that came up while reviewing the plan: what does the
LLM actually do, does Parallel.ai still matter, and what does a query cost.

## 1. What the LLM (OpenAI) Actually Does

This is still a chat agent from the user's seat — natural language in, conversational
follow-ups supported. What changed from the first draft is *how the backend guarantees
correctness*, not what the user experiences.

**Removed:** an agentic tool-calling loop where the LLM decided, per query, which of the data
tools to call and in what order. The field-sourcing logic is fully known ahead of time (every
field has a fixed primary source and a fixed fallback rule — see PRD §5), so there was nothing
for the model to usefully improvise. Letting it do so anyway would add non-determinism and
hallucination risk — a real LLM-driven loop can skip a fallback step or misroute a field — for
zero functional benefit. That's complexity added for nothing, and it directly worked against
"no compromise on data accuracy."

**Kept — the two places natural language is actually the job:**
1. **Address parsing**: reads the user's free-text chat message and extracts/normalizes a
   clean US address. This is a narrow, well-bounded extraction task.
2. **Follow-up Q&A**: after the deterministic pipeline returns structured data, the model
   answers conversational follow-ups ("how old is the roof?") using *only* the already-fetched
   result for that address — never re-fetching, never inventing a fact that isn't in the
   result set. If the answer isn't in the data, it says so.

Everything in between — calling RentCast, deciding whether a field needs a fallback, calling
Parallel.ai, computing hydrant/station distances — is plain, deterministic TypeScript. This is
the standard "workflow with an LLM at the edges" pattern (as opposed to a fully autonomous
agent loop) for tasks where the steps are fixed in advance — more reliable, and cheaper to run
since address parsing and follow-ups are the only two calls that touch a frontier model.

## 2. Where Parallel.ai Fits

Unchanged in role since the last revision: **the fallback layer, not a primary data path.**
Every one of the 9 fields follows one rule — call RentCast, and if it returns null, call
Parallel.ai. There is one added trigger: a recency-based cross-check on bed/bath/sqft when the
property sold or was listed in the last ~2 years (assessor records can be stale for recently
renovated homes; see PRD §5 for the full reasoning).

Regrid was in an earlier draft as a structured second opinion for owner name specifically, but
was cut once its pricing turned out to be a $500–$2,000/mo subscription rather than pay-per-call
— a bad trade for an occasional single-field fallback (see `decisions.md`). Owner name now
follows the same RentCast → Parallel.ai rule as everything else.

**Update from Ticket 4 (2026-08-26):** owner/mortgagee ship on Parallel's `base` processor
tier by default, not `core` as originally planned below — live testing found `core` took
~3.5 minutes for a single mortgagee lookup, and since mortgagee fires on nearly every query
(RentCast almost never has it), defaulting to `core` would make most queries take minutes
instead of seconds. `core` is now an opt-in `deepResearch` flag for when accuracy matters more
than speed on those two fields. The cost table below still shows the original `core`-based
estimate — see the corrected numbers immediately after it.

## 3. Per-Query Cost Model

### Method and sources
Costs below are computed from published pricing, not guesses — sources linked inline. Where a
number depends on how often a fallback actually fires (its "hit rate"), that's an **estimate**
based on known field-coverage gaps from the research phase (e.g., mortgagee is the weakest
RentCast field), not a measured value. Ticket 8 (manual QA) will produce real hit rates against
actual queries — **this doc should be updated with observed numbers once that ticket lands.**

### Cost per call, by provider

| Provider | Unit cost | Source |
|---|---|---|
| US Census Geocoder | $0 | Free public API |
| HIFLD fire station dataset | $0 | Static download, bundled/cached locally |
| OSM Overpass (fire hydrant) | $0 | Free public API |
| OpenAI `gpt-4o-mini` (address parsing / follow-ups) | $0.15 / 1M input tokens, $0.60 / 1M output tokens | [pricepertoken.com](https://pricepertoken.com/pricing-page/model/openai-gpt-4o-mini) |
| RentCast — Developer plan | $0 for first 50 requests/mo, then **$0.20/request** overage | [rentcast.io/api](https://www.rentcast.io/api) |
| RentCast — Foundation plan | $74/mo incl. 1,000 requests (**$0.074/call** amortized), $0.06/call overage | [rentcast.io/api](https://www.rentcast.io/api) |
| RentCast — Growth plan | $199/mo incl. 5,000 requests (**$0.040/call** amortized), $0.03/call overage | [rentcast.io/api](https://www.rentcast.io/api) |
| RentCast — Scale plan | $449/mo incl. 25,000 requests (**$0.018/call** amortized), $0.015/call overage | [rentcast.io/api](https://www.rentcast.io/api) |
| Parallel.ai — `lite` processor | $5 / 1,000 runs = **$0.005/call** | [docs.parallel.ai/pricing](https://docs.parallel.ai/getting-started/pricing) |
| Parallel.ai — `base` processor | $10 / 1,000 runs = **$0.010/call** | same |
| Parallel.ai — `core` processor | $25 / 1,000 runs = **$0.025/call** (94% accuracy, used for the harder lookups: owner, mortgagee) | same |

### Per-query breakdown (one address lookup, no follow-up questions)

| Component | Assumption | Cost |
|---|---|---|
| OpenAI address parsing | 1 call, ~150 in / ~60 out tokens | ~$0.0001 |
| RentCast property record | 1 call, always | plan-dependent (see below) |
| Parallel.ai — mortgagee null-fill | fires ~90% of queries (weakest RentCast field), `core` tier | 0.90 × $0.025 = $0.0225 |
| Parallel.ai — owner null-fill | fires ~15% of queries (RentCast usually has it), `core` tier | 0.15 × $0.025 = $0.0038 |
| Parallel.ai — HVAC null-fill | fires ~50% of queries (inconsistently populated), `base` tier | 0.50 × $0.010 = $0.0050 |
| Parallel.ai — bed/bath/sqft cross-check | fires ~20% of queries (recency trigger), `base` tier | 0.20 × $0.010 = $0.0020 |
| **Parallel.ai subtotal** | | **≈ $0.033/query** |
| Geocoding, fire station, fire hydrant | Census + HIFLD + Overpass | $0 |

**Total per query = ~$0.033 (AI/enrichment side) + RentCast's per-call cost, which depends
entirely on which plan tier you're on:**

| RentCast plan | RentCast cost/call | **Total cost per query** |
|---|---|---|
| Developer, within free 50/mo | $0 | **~$0.033** |
| Developer, overage beyond 50/mo | $0.20 | **~$0.233** |
| Foundation (amortized) | $0.074 | **~$0.107** |
| Growth (amortized) | $0.040 | **~$0.073** |
| Scale (amortized) | $0.018 | **~$0.051** |

A follow-up question in the same chat adds one more small OpenAI call (~$0.0005–$0.001,
depending on how much structured context is in play) — not counted above since it's optional,
not part of every query.

**Corrected for what actually shipped in Ticket 4:** owner/mortgagee null-fill run on `base`
($0.010/call), not `core` ($0.025/call), by default.

| Component | Assumption | Cost |
|---|---|---|
| Parallel.ai — mortgagee null-fill | fires ~90% of queries, `base` tier | 0.90 × $0.010 = $0.0090 |
| Parallel.ai — owner null-fill | fires ~15% of queries, `base` tier | 0.15 × $0.010 = $0.0015 |
| Parallel.ai — HVAC null-fill | fires ~50% of queries, `base` tier | 0.50 × $0.010 = $0.0050 |
| Parallel.ai — bed/bath/sqft cross-check | fires ~20% of queries, `base` tier | 0.20 × $0.010 = $0.0020 |
| **Parallel.ai subtotal (base tier, default)** | | **≈ $0.018/query** |

Roughly half the original `core`-based estimate (~$0.033 → ~$0.018/query). Deep research mode
(`deepResearch: true`) reverts owner/mortgagee to the original `core`-tier cost and the ~3.5
minute latency that comes with it — an explicit opt-in trade, not the default path.

### Monthly cost at realistic MVP volumes

| Monthly queries | Recommended RentCast plan | RentCast cost | Parallel.ai cost | **Total/mo** |
|---|---|---|---|---|
| 10 (light testing) | Developer (free) | $0 | ~$0.33 | **~$0.33** |
| 50 (demo-scale, stays in free tier) | Developer (free) | $0 | ~$1.65 | **~$1.65** |
| 200 | Developer + overage | $30 (150 × $0.20) | ~$6.60 | **~$36.60** |
| 1,000 | Foundation | $74 | ~$33 | **~$107** |

**One actionable number for the plan-choice decision:** the Developer plan's overage fee
($0.20/call) crosses over Foundation's flat $74/mo at **~420 queries/month** (74 ÷ 0.20 = 370
overage calls + the 50 free ones). Below that volume, stay on Developer and eat the overage;
above it, upgrade to Foundation. For an internal single-user MVP, expect to stay well under
that line for a while.

## 4. Caveats

- Parallel.ai hit-rate assumptions (90% mortgagee, 15% owner, 50% HVAC, 20% cross-check) are
  estimates from the research phase, not measured data. Update this doc once Ticket 8 QA
  produces real numbers against actual addresses.
- Processor tier choices (`core` for owner/mortgagee, `base` for HVAC/cross-check) are a
  starting recommendation balancing cost against accuracy on the harder lookups — revisit if
  QA shows `base` is sufficient for owner/mortgagee too, or `core` is needed elsewhere.
- All pricing reflects publicly published rates as of 2026-08-25; RentCast and Parallel.ai
  could change pricing without notice — reconfirm before the presentation if this doc is more
  than a few weeks old.
