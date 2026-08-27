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
 * POST /api/research's success shape for a follow-up-question turn (Ticket
 * 7): the message didn't contain a new address, and a `previousResult` was
 * supplied, so it's answered from already-fetched data only — never
 * re-fetched, never fabricated beyond what's in `fields` (PRD.md §4/§6).
 * A turn that *does* find a new address to research streams progressively
 * instead, as `ResearchStreamEvent`s (Ticket 9) — it never returns this
 * shape as a single JSON body.
 */
export type ChatResponse = { type: "answer"; answer: string };

/**
 * GET /api/autocomplete's response shape (Ticket 10) — address suggestions
 * for the chat input as the user types. This is a UI convenience only, not
 * part of the research pipeline: picking a suggestion just fills the
 * message box, and the real geocode still runs through the existing
 * US Census pipeline unchanged once the user hits Research. Always 200,
 * `suggestions: []` for both "too short to search" and "upstream lookup
 * failed" — autocomplete not working should never block typing or
 * submitting a full address manually.
 */
export interface AutocompleteResponse {
  suggestions: Array<{ id: string; label: string }>;
}

export type ApiErrorCode = "INVALID_INPUT" | "NO_MATCH" | "NO_ADDRESS_FOUND" | "UPSTREAM_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/**
 * Server-Sent Events emitted by POST /api/research while it researches a
 * newly-found address (Ticket 9). Requests can take up to several minutes
 * (deep research mode) — streaming each field as it individually resolves,
 * instead of one silent wait followed by a single JSON blob, is what lets
 * the UI show real progress instead of a generic spinner.
 *
 * Geocoding happens *before* this stream starts (see route.ts), so a
 * geocoding failure still surfaces as a normal HTTP error status, never as
 * an "error" event. Once the stream has started the response is already
 * committed to 200, so any later unexpected failure has to be reported as
 * an "error" event instead of a status code.
 */
export type ResearchStreamEvent =
  | { type: "geocode"; geocode: GeocodeResult }
  | { type: "field"; field: FieldResult }
  | { type: "done"; result: ResearchResult }
  | { type: "error"; code: ApiErrorCode; message: string };
