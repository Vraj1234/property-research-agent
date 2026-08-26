const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type OverpassErrorCode = "UPSTREAM_ERROR";

/** Thrown for a genuine Overpass failure — network error, non-2xx response,
 * or an unparsable body. Zero matching nodes is NOT this — an empty result
 * is an honest, expected outcome (PRD.md §5's documented OSM coverage-gap
 * limitation), returned as `[]`, not an error. */
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
 * Queries the public OSM Overpass API for nodes tagged `${tagKey}=${tagValue}`
 * within `radiusMeters` of a point. Used for both fire station and fire
 * hydrant distance (PRD.md §5/§6) — no API key, no per-call cost.
 */
export async function queryNearbyNodes(
  latitude: number,
  longitude: number,
  tagKey: string,
  tagValue: string,
  radiusMeters: number,
): Promise<OverpassNode[]> {
  const query =
    `[out:json][timeout:25];` +
    `node["${tagKey}"="${tagValue}"](around:${radiusMeters},${latitude},${longitude});` +
    `out body;`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: "POST",
      // Live-tested 2026-08-26: Node's default fetch (undici) headers made
      // this endpoint return HTTP 406 every time, while an identical request
      // via curl or Node's raw `https` module succeeded — Overpass's Apache
      // front end appears to fingerprint the auto-added Accept/Accept-Encoding/
      // Accept-Language/Sec-Fetch-Mode/User-Agent combination undici sends by
      // default. Setting conventional values for all of them explicitly
      // reliably returns 200; overriding any single one alone did not.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Accept-Language": "en-US",
        "Sec-Fetch-Mode": "no-cors",
        "User-Agent": "property-research-agent/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch {
    throw new OverpassError("UPSTREAM_ERROR", "Could not reach the OpenStreetMap Overpass API.");
  }

  if (!response.ok) {
    throw new OverpassError("UPSTREAM_ERROR", `Overpass API returned HTTP ${response.status}.`);
  }

  let body: OverpassResponse;
  try {
    body = (await response.json()) as OverpassResponse;
  } catch {
    throw new OverpassError(
      "UPSTREAM_ERROR",
      "Overpass API returned a response that could not be parsed as JSON.",
    );
  }

  return (body.elements ?? []).map((el) => ({
    lat: el.lat,
    lon: el.lon,
    name: el.tags?.name ?? null,
  }));
}
