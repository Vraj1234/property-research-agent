import { geocodeAddress } from "./geocode";
import { getPropertyRecord, RentCastError, type RentCastPropertyRecord } from "./rentcast";
import type { Confidence, FieldResult, PropertyFieldKey, ResearchResult } from "./types";

/** Every field this ticket sources from RentCast. Mortgagee is intentionally
 * absent here — RentCast never returns it, so it's left out of `fields`
 * until Ticket 4 actually attempts to source it via Parallel.ai, rather than
 * added now as a stub nothing has tried yet. */
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

/**
 * Deterministic pipeline entry point — no LLM in this loop (PRD.md §6).
 * Geocoding hard-fails the whole request on miss (unchanged from Ticket 2);
 * a RentCast lookup failure does not — it degrades to honest "not found"
 * fields with an explanatory note instead of taking down a request that
 * already successfully geocoded (PRD.md §8: never a silent omission, but
 * also never a scary 500 over one provider's outage). Tickets 4-5 will
 * extend this further with the Parallel.ai fallback and the fire
 * station/hydrant distance tools.
 */
export async function researchAddress(address: string): Promise<ResearchResult> {
  const geocode = await geocodeAddress(address);

  let fields: FieldResult[];
  try {
    const record = await getPropertyRecord(address);
    fields =
      record === null
        ? notFoundFields("No RentCast property record found for this address.")
        : fieldsFromRecord(record);
  } catch (err) {
    const message = err instanceof RentCastError ? err.message : "Unexpected RentCast failure.";
    console.error("[researchAddress] RentCast lookup failed:", err);
    fields = notFoundFields(`RentCast lookup failed: ${message}`);
  }

  return {
    input: { address },
    geocode,
    fields,
  };
}
