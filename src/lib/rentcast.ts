import type { BedBathCount } from "./types";

const RENTCAST_PROPERTIES_URL = "https://api.rentcast.io/v1/properties";

export type RentCastErrorCode = "UPSTREAM_ERROR";

/**
 * Thrown when RentCast itself fails (missing config, network error, or a
 * non-2xx status other than the "no address match" case). A missing property
 * record is NOT an error — see getPropertyRecord's `null` return — a gap in
 * assessor coverage is an expected, honest outcome (PRD.md §8), not a
 * pipeline failure.
 */
export class RentCastError extends Error {
  constructor(
    public readonly code: RentCastErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RentCastError";
  }
}

/**
 * The subset of RentCast's Property Records response this app maps and uses.
 * Mortgagee/lender is deliberately absent: RentCast's Property Records
 * endpoint doesn't return mortgage data at all (confirmed against live
 * responses), so that field is sourced entirely through the Ticket 4
 * Parallel.ai fallback rather than mapped here as an always-null stub.
 */
export interface RentCastPropertyRecord {
  bedBathCount: BedBathCount | null;
  squareFootage: number | null;
  yearBuilt: number | null;
  ownerNames: string[] | null;
  /** Human-readable combination of RentCast's heating/cooling fields, e.g. "Forced Air heating, Central cooling". */
  hvacType: string | null;
  /** Most recent year's total from RentCast's `propertyTaxes` map. */
  propertyTaxAmount: number | null;
  /** ISO date string. Recency signal for Ticket 4's stale-assessor-data cross-check. */
  lastSaleDate: string | null;
}

interface RentCastApiRecord {
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  lastSaleDate?: string;
  owner?: {
    names?: string[];
  };
  features?: {
    heating?: boolean;
    heatingType?: string;
    cooling?: boolean;
    coolingType?: string;
  };
  propertyTaxes?: Record<string, { year: number; total: number }>;
}

function mapHvacType(features: RentCastApiRecord["features"]): string | null {
  if (!features) return null;

  const parts: string[] = [];
  if (features.heating) {
    parts.push(features.heatingType ? `${features.heatingType} heating` : "Heating");
  }
  if (features.cooling) {
    parts.push(features.coolingType ? `${features.coolingType} cooling` : "Cooling");
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function mapPropertyTaxAmount(
  propertyTaxes: RentCastApiRecord["propertyTaxes"],
): number | null {
  const years = Object.values(propertyTaxes ?? {});
  if (years.length === 0) return null;

  const mostRecent = years.reduce((latest, entry) =>
    entry.year > latest.year ? entry : latest,
  );
  return mostRecent.total ?? null;
}

function mapBedBathCount(record: RentCastApiRecord): BedBathCount | null {
  const bedrooms = record.bedrooms ?? null;
  const bathrooms = record.bathrooms ?? null;
  if (bedrooms === null && bathrooms === null) return null;
  return { bedrooms, bathrooms };
}

function mapOwnerNames(owner: RentCastApiRecord["owner"]): string[] | null {
  return owner?.names && owner.names.length > 0 ? owner.names : null;
}

function mapPropertyRecord(record: RentCastApiRecord): RentCastPropertyRecord {
  return {
    bedBathCount: mapBedBathCount(record),
    squareFootage: record.squareFootage ?? null,
    yearBuilt: record.yearBuilt ?? null,
    ownerNames: mapOwnerNames(record.owner),
    hvacType: mapHvacType(record.features),
    propertyTaxAmount: mapPropertyTaxAmount(record.propertyTaxes),
    lastSaleDate: record.lastSaleDate ?? null,
  };
}

/**
 * Looks up a property record via RentCast's Property Records API.
 *
 * Returns `null` when RentCast has no record for the address. Confirmed
 * against live responses, RentCast represents "no record" three different
 * ways depending on why: HTTP 400 (`resource/bad-request`) for an address it
 * can't parse/geolocate at all, HTTP 404 for an address it understands but
 * has no property data for (e.g. a real, geocodable commercial building),
 * and HTTP 200 with an empty array in cases the array response shape allows
 * for. All three are treated as "no record," not a failure. Throws
 * RentCastError only for genuine upstream failures (missing config, network
 * error, auth/rate-limit/server errors, unparsable response body).
 */
export async function getPropertyRecord(
  address: string,
): Promise<RentCastPropertyRecord | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    throw new RentCastError("UPSTREAM_ERROR", "RENTCAST_API_KEY is not configured.");
  }

  const url = new URL(RENTCAST_PROPERTIES_URL);
  url.searchParams.set("address", address);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "X-Api-Key": apiKey },
    });
  } catch {
    throw new RentCastError("UPSTREAM_ERROR", "Could not reach the RentCast API.");
  }

  if (response.status === 400 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new RentCastError(
      "UPSTREAM_ERROR",
      `RentCast API returned HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RentCastError(
      "UPSTREAM_ERROR",
      "RentCast API returned a response that could not be parsed as JSON.",
    );
  }

  const records = Array.isArray(body) ? body : [];
  const record = records[0] as RentCastApiRecord | undefined;
  if (!record) {
    return null;
  }

  return mapPropertyRecord(record);
}
