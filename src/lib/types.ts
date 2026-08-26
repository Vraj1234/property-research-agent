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

/**
 * The result for a single field. `value` and `source` are both `null` when no
 * provider (primary or fallback) could find the field — this must be surfaced
 * honestly to the user, never silently omitted or fabricated (PRD.md §8).
 */
export interface FieldResult<T = unknown> {
  field: PropertyFieldKey;
  value: T | null;
  /** Name of the provider that supplied the value, e.g. "RentCast", "Parallel.ai", "HIFLD". */
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

/** Full response shape for POST /api/research. Later tickets populate `fields`. */
export interface ResearchResult {
  input: { address: string };
  geocode: GeocodeResult;
  fields: FieldResult[];
}

export type ApiErrorCode = "INVALID_INPUT" | "NO_MATCH" | "UPSTREAM_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
