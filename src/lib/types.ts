/**
 * Shared result contract for the property research pipeline.
 * See PRD.md §5 (field -> source matrix) and §6 (architecture).
 */

/** The 9 fields the agent researches per address, per PRD.md §2/§5. */
export type PropertyFieldKey =
  | "bedBathCount"
  | "squareFootage"
  | "yearBuilt"
  | "ownerName"
  | "mortgagee"
  | "hvacType"
  | "propertyTaxAmount"
  | "nearestFireStationDistance"
  | "nearestFireHydrantDistance";

export type Confidence = "high" | "medium" | "low";

/**
 * Value shape for the `bedBathCount` field. Kept as two independently
 * nullable numbers rather than a single combined count — a provider can
 * know one and not the other, and collapsing that into one value would
 * hide a partial result behind a false-confident single number.
 */
export interface BedBathCount {
  bedrooms: number | null;
  bathrooms: number | null;
}

/** Value shape for `nearestFireStationDistance` / `nearestFireHydrantDistance`. */
export interface NearbyDistance {
  distanceMiles: number;
  /** OSM's `name` tag for the matched node, when present — most fire
   * hydrants have none; most fire stations do. */
  name: string | null;
}

/**
 * The result for a single field. `value` and `source` are both `null` when no
 * provider (primary or fallback) could find the field — this must be surfaced
 * honestly to the user, never silently omitted or fabricated (PRD.md §8).
 */
export interface FieldResult<T = unknown> {
  field: PropertyFieldKey;
  value: T | null;
  /** Name of the provider that supplied the value, e.g. "RentCast", "Parallel.ai", "OpenStreetMap Overpass". */
  source: string | null;
  confidence: Confidence | null;
  /** Optional caveat surfaced to the user, e.g. sparse OSM hydrant coverage nearby. */
  note?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** The standardized address the geocoder actually matched against. */
  matchedAddress: string;
}

/** Full response shape for POST /api/research. */
export interface ResearchResult {
  input: { address: string; deepResearch: boolean };
  geocode: GeocodeResult;
  fields: FieldResult[];
  /** User-facing heads-up messages not tied to any one field, e.g. the
   * deep-research latency warning (Ticket 4, decisions.md 2026-08-26). */
  notices: string[];
}

/**
 * POST /api/research's success shape (Ticket 7). A message either contains
 * a new address to research, or — when it doesn't and a `previousResult`
 * was supplied — is treated as a follow-up question about that result
 * (PRD.md §4/§6: answered from already-fetched data only, never re-fetched,
 * never fabricated beyond what's in `fields`).
 */
export type ChatResponse = { type: "research"; result: ResearchResult } | { type: "answer"; answer: string };

export type ApiErrorCode = "INVALID_INPUT" | "NO_MATCH" | "NO_ADDRESS_FOUND" | "UPSTREAM_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
