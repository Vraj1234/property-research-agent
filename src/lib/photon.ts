export type PhotonErrorCode = "UPSTREAM_ERROR";

/** Thrown for a genuine Photon failure — network error, non-2xx response, or
 * an unparsable body. Zero matches is NOT this — it's an honest empty
 * result, returned as `[]`. Matches the typed-error convention used by every
 * other provider client in this codebase (rentcast.ts, overpass.ts). */
export class PhotonError extends Error {
  constructor(
    public readonly code: PhotonErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PhotonError";
  }
}

export interface AddressSuggestion {
  id: string;
  label: string;
}

interface PhotonProperties {
  osm_id: number;
  housenumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postcode?: string;
  countrycode?: string;
}

interface PhotonResponse {
  features?: Array<{ properties: PhotonProperties }>;
}

const PHOTON_URL = "https://photon.komoot.io/api/";
const SUGGESTION_LIMIT = 5;

/** Builds a single-line US mailing address from Photon's fields, or `null`
 * when the result isn't specific enough to be a real street address (a
 * city, a bare street with no house number, a POI). This is an autocomplete
 * convenience, not the pipeline's own geocoder — the full address string
 * still goes through the existing US Census geocode + RentCast/Parallel.ai
 * pipeline unchanged once the user picks a suggestion or hits Research. */
function formatAddressLabel(p: PhotonProperties): string | null {
  if (!p.housenumber || !p.street) return null;
  const line1 = `${p.housenumber} ${p.street}`;
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, p.postcode].filter(Boolean).join(" ");
  return [line1, cityStateZip].filter(Boolean).join(", ");
}

/**
 * US address suggestions for autocomplete-as-you-type, via Photon
 * (komoot's free, no-API-key-required public geocoder — a different host
 * than the OSM Overpass mirrors this app also uses, so unaffected by
 * Overpass's own rate-limit history, see decisions.md). Purpose-built for
 * partial input, unlike the US Census Geocoder this app uses for the real
 * pipeline (geocodeAddress), which only resolves a complete address.
 */
export async function getAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(SUGGESTION_LIMIT));
  url.searchParams.set("lang", "en");

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new PhotonError("UPSTREAM_ERROR", "Could not reach the Photon address-suggestion API.");
  }

  if (!response.ok) {
    throw new PhotonError("UPSTREAM_ERROR", `Photon API returned HTTP ${response.status}.`);
  }

  let body: PhotonResponse;
  try {
    body = (await response.json()) as PhotonResponse;
  } catch {
    throw new PhotonError(
      "UPSTREAM_ERROR",
      "Photon API returned a response that could not be parsed as JSON.",
    );
  }

  const seenLabels = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  for (const feature of body.features ?? []) {
    const { properties } = feature;
    if (properties.countrycode !== "US") continue;
    const label = formatAddressLabel(properties);
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    suggestions.push({ id: String(properties.osm_id), label });
  }
  return suggestions;
}
