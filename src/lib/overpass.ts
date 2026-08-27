export type OverpassErrorCode = "UPSTREAM_ERROR";

/** Thrown for a genuine Overpass failure — network error, non-2xx response,
 * or an unparsable body, on every configured mirror. Zero matching nodes is
 * NOT this — an empty result is an honest, expected outcome (PRD.md §5's
 * documented OSM coverage-gap limitation), returned as `[]`, not an error. */
export class OverpassError extends Error {
  constructor(
    public readonly code: OverpassErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OverpassError";
  }
}

export interface OverpassNode {
  lat: number;
  lon: number;
  name: string | null;
}

interface OverpassResponse {
  elements?: Array<{ lat: number; lon: number; tags?: Record<string, string> }>;
}

/**
 * Public Overpass API mirrors, tried in order until one returns a usable
 * result. Live-verified 2026-08-27 (see decisions.md):
 * - `maps.mail.ru` (VK Maps' mirror) answered every test query with correct,
 *   current OSM data and no observed rate limiting — kept as primary.
 * - `overpass-api.de` (the "default" instance this project relied on
 *   exclusively before today) was flatly unreachable — TCP connection
 *   refused/timed out on both of its resolved IPs, over both IPv4 and IPv6.
 *   FOSSGIS's own wiki now warns "this server is overloaded," which matches
 *   what we saw better than the earlier "our IP got rate-limited" theory in
 *   this file's history — that theory never had a confirmed 429 behind it.
 *   Kept as a fallback since it's still the reference implementation and may
 *   recover.
 * - `overpass.private.coffee` is wiki-listed as having no rate limit and
 *   returned a consistent HTTP 500 in testing (same backend as
 *   `overpass.kumi.systems`, which mirrors it) — kept as a third attempt
 *   since trying it costs nothing.
 * - `overpass.osm.ch` was deliberately EXCLUDED. It returns HTTP 200 with a
 *   well-formed but entirely empty dataset for every query tested, including
 *   a restaurant count in downtown Seattle that should never be zero — a
 *   silent false-negative trap that's worse than an outage, since it would
 *   confidently report real hydrants/stations as "not found."
 */
const OVERPASS_MIRRORS: readonly string[] = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Live-tested response times against a working mirror ranged from ~1s to
 * ~22s for the same query — generous on purpose so a slow-but-working mirror
 * isn't abandoned before it can answer. */
const MIRROR_TIMEOUT_MS = 25_000;

/** Live-tested 2026-08-27: even the primary mirror is flaky moment-to-moment,
 * not just mirror-to-mirror — a trivial single-node query timed out outright,
 * then an identical-shape query against it succeeded seconds later. A single
 * failed attempt is therefore not strong evidence a mirror is actually down,
 * so each mirror gets a second try (with a short pause) before moving on. */
const ATTEMPTS_PER_MIRROR = 2;
const RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromMirror(url: string, query: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "POST",
      // Live-tested 2026-08-26: Node's default fetch (undici) headers
      // triggered an HTTP 406 from overpass-api.de's Apache front end.
      // Setting these explicitly fixed it at the time, but decisions.md
      // (2026-08-27) found that fix wasn't reliable on its own — most likely
      // a coincidence of which load-balanced mirror server answered. Left in
      // place since it's harmless and may still help against some mirrors;
      // the multi-mirror fallback below is the actual reliability fix.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US",
        "Sec-Fetch-Mode": "no-cors",
        "User-Agent": "property-research-agent/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Queries the public OSM Overpass API for nodes tagged `${tagKey}=${tagValue}`
 * within `radiusMeters` of a point. Used for both fire station and fire
 * hydrant distance (PRD.md §5/§6) — no API key, no per-call cost.
 *
 * Tries each entry in `OVERPASS_MIRRORS` in order, up to `ATTEMPTS_PER_MIRROR`
 * times each, falling through to the next mirror on any network error,
 * non-2xx response, or unparsable body. Only throws once every mirror has
 * exhausted its attempts — neither a single flaky request nor a single
 * mirror being down takes the field down with it.
 */
export async function queryNearbyNodes(
  latitude: number,
  longitude: number,
  tagKey: string,
  tagValue: string,
  radiusMeters: number,
): Promise<OverpassNode[]> {
  const query =
    `[out:json][timeout:20];` +
    `node["${tagKey}"="${tagValue}"](around:${radiusMeters},${latitude},${longitude});` +
    `out body;`;

  let lastError = "no mirrors configured";
  let totalAttempts = 0;

  for (const mirrorUrl of OVERPASS_MIRRORS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MIRROR; attempt++) {
      totalAttempts += 1;
      const isLastAttemptForThisMirror = attempt === ATTEMPTS_PER_MIRROR;

      let response: Response;
      try {
        response = await fetchFromMirror(mirrorUrl, query);
      } catch {
        lastError = `could not reach ${mirrorUrl} (attempt ${attempt}/${ATTEMPTS_PER_MIRROR})`;
        if (!isLastAttemptForThisMirror) await delay(RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok) {
        lastError = `${mirrorUrl} returned HTTP ${response.status} (attempt ${attempt}/${ATTEMPTS_PER_MIRROR})`;
        if (!isLastAttemptForThisMirror) await delay(RETRY_DELAY_MS);
        continue;
      }

      let body: OverpassResponse;
      try {
        body = (await response.json()) as OverpassResponse;
      } catch {
        lastError = `${mirrorUrl} returned a response that could not be parsed as JSON (attempt ${attempt}/${ATTEMPTS_PER_MIRROR})`;
        if (!isLastAttemptForThisMirror) await delay(RETRY_DELAY_MS);
        continue;
      }

      return (body.elements ?? []).map((el) => ({
        lat: el.lat,
        lon: el.lon,
        name: el.tags?.name ?? null,
      }));
    }
  }

  throw new OverpassError(
    "UPSTREAM_ERROR",
    `Could not reach the OpenStreetMap Overpass API on any mirror (${totalAttempts} attempts across ${OVERPASS_MIRRORS.length} mirrors). Last error: ${lastError}.`,
  );
}
