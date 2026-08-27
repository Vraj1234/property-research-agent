import { distanceFields } from "./distanceFields";
import { geocodeAddress } from "./geocode";
import { getPropertyRecord, RentCastError, type RentCastPropertyRecord } from "./rentcast";
import { webResearchFallback, type FieldResolvedCallback } from "./webResearchFallback";
import type { Confidence, FieldResult, GeocodeResult, PropertyFieldKey, ResearchResult } from "./types";

/** Every field this ticket sources from RentCast. Mortgagee is intentionally
 * absent here — RentCast never returns it, so it's left out of `baseFields`
 * entirely; Ticket 4's webResearchFallback appends it after attempting it
 * via Parallel.ai, the only provider that ever supplies it. */
const RENTCAST_FIELDS: PropertyFieldKey[] = [
  "bedBathCount",
  "squareFootage",
  "yearBuilt",
  "ownerName",
  "hvacType",
  "propertyTaxAmount",
];

function notFoundFields(note: string): FieldResult[] {
  return RENTCAST_FIELDS.map((field) => ({
    field,
    value: null,
    source: null,
    confidence: null,
    note,
  }));
}

function bedBathConfidence(record: RentCastPropertyRecord): Confidence | null {
  const { bedBathCount } = record;
  if (bedBathCount === null) return null;
  return bedBathCount.bedrooms !== null && bedBathCount.bathrooms !== null
    ? "high"
    : "medium";
}

/** Builds a FieldResult for a RentCast-sourced value: "high" confidence and
 * "RentCast" as the source when present, otherwise honestly null (PRD.md §8). */
function rentCastField<T>(field: PropertyFieldKey, value: T | null): FieldResult<T> {
  return {
    field,
    value,
    source: value === null ? null : "RentCast",
    confidence: value === null ? null : "high",
  };
}

function fieldsFromRecord(record: RentCastPropertyRecord): FieldResult[] {
  return [
    {
      field: "bedBathCount",
      value: record.bedBathCount,
      source: record.bedBathCount === null ? null : "RentCast",
      confidence: bedBathConfidence(record),
    },
    rentCastField("squareFootage", record.squareFootage),
    rentCastField("yearBuilt", record.yearBuilt),
    rentCastField("ownerName", record.ownerNames),
    rentCastField("hvacType", record.hvacType),
    rentCastField("propertyTaxAmount", record.propertyTaxAmount),
  ];
}

export interface ResearchAddressOptions {
  /** Opt-in deep research for mortgagee/owner via Parallel's `core` tier —
   * much slower (~3.5 min observed vs. ~15-40s on `base`), see decisions.md
   * 2026-08-26. Off by default. */
  deepResearch?: boolean;
}

/** RentCast → Parallel.ai pipeline for the 7 fields the fallback rule
 * covers (PRD.md §5). Split out so it can run in parallel with the
 * geometry-only distance fields (Ticket 5), which need nothing from
 * RentCast or Parallel.ai. */
async function getPropertyFields(
  address: string,
  deepResearch: boolean,
  onFieldResolved?: FieldResolvedCallback,
): Promise<FieldResult[]> {
  let baseFields: FieldResult[];
  let lastSaleDate: string | null = null;
  try {
    const record = await getPropertyRecord(address);
    if (record === null) {
      baseFields = notFoundFields("No RentCast property record found for this address.");
    } else {
      baseFields = fieldsFromRecord(record);
      lastSaleDate = record.lastSaleDate;
    }
  } catch (err) {
    const message = err instanceof RentCastError ? err.message : "Unexpected RentCast failure.";
    console.error("[researchAddress] RentCast lookup failed:", err);
    baseFields = notFoundFields(`RentCast lookup failed: ${message}`);
  }

  return webResearchFallback(address, baseFields, lastSaleDate, { deepResearch }, onFieldResolved);
}

export interface ResearchFieldsResult {
  fields: FieldResult[];
  notices: string[];
}

/**
 * Runs the RentCast/Parallel.ai pipeline and the fire station/hydrant
 * distance lookups against an already-geocoded point, in parallel (PRD.md
 * §8) since neither depends on the other. Split out from `researchAddress`
 * (Ticket 9) so a caller that wants to stream progress — `/api/research`'s
 * route handler — can supply `onFieldResolved` and get each of the 9 fields
 * the moment it individually settles, instead of waiting for all of them.
 * `researchAddress` below is the non-streaming convenience wrapper around
 * this same logic.
 */
export async function researchFields(
  address: string,
  geocode: GeocodeResult,
  options: ResearchAddressOptions = {},
  onFieldResolved?: FieldResolvedCallback,
): Promise<ResearchFieldsResult> {
  const deepResearch = options.deepResearch ?? false;

  const [propertyFields, geometryFields] = await Promise.all([
    getPropertyFields(address, deepResearch, onFieldResolved),
    distanceFields(geocode.latitude, geocode.longitude, onFieldResolved),
  ]);

  const notices: string[] = [];
  if (deepResearch) {
    notices.push(
      "Deep research mode is enabled for mortgagee/owner lookups — this request may take several minutes.",
    );
  }

  return { fields: [...propertyFields, ...geometryFields], notices };
}

/**
 * Deterministic pipeline entry point — no LLM in this loop (PRD.md §6).
 * Geocoding hard-fails the whole request on miss (unchanged from Ticket 2);
 * a RentCast lookup failure does not — it degrades to honest "not found"
 * fields that the fallback layer still gets a chance to fill via
 * Parallel.ai, rather than taking down a request that already successfully
 * geocoded (PRD.md §8: never a silent omission, but also never a scary 500
 * over one provider's outage).
 */
export async function researchAddress(
  address: string,
  options: ResearchAddressOptions = {},
): Promise<ResearchResult> {
  const geocode = await geocodeAddress(address);
  const { fields, notices } = await researchFields(address, geocode, options);

  return {
    input: { address, deepResearch: options.deepResearch ?? false },
    geocode,
    fields,
    notices,
  };
}
