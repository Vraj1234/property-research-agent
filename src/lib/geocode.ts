import type { GeocodeResult } from "./types";

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodingErrorCode = "NO_MATCH" | "UPSTREAM_ERROR";

/**
 * Thrown when an address can't be geocoded. Per PRD.md §5, there is deliberately
 * no second geocoder fallback — a clear, typed failure here is preferred over a
 * silent guess.
 */
export class GeocodingError extends Error {
  constructor(
    public readonly code: GeocodingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeocodingError";
  }
}

interface CensusGeocoderResponse {
  result: {
    addressMatches: Array<{
      coordinates: { x: number; y: number };
      matchedAddress: string;
    }>;
  };
}

/**
 * Geocodes a US address via the free US Census Geocoder (no API key required).
 * Throws GeocodingError("NO_MATCH") if the address can't be resolved, or
 * GeocodingError("UPSTREAM_ERROR") if the Census API itself fails.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new GeocodingError(
      "UPSTREAM_ERROR",
      "Could not reach the US Census Geocoder.",
    );
  }

  if (!response.ok) {
    throw new GeocodingError(
      "UPSTREAM_ERROR",
      `US Census Geocoder returned HTTP ${response.status}.`,
    );
  }

  let body: CensusGeocoderResponse;
  try {
    body = (await response.json()) as CensusGeocoderResponse;
  } catch {
    throw new GeocodingError(
      "UPSTREAM_ERROR",
      "US Census Geocoder returned a response that could not be parsed as JSON.",
    );
  }

  const match = body.result?.addressMatches?.[0];
  if (!match) {
    throw new GeocodingError(
      "NO_MATCH",
      `Could not geocode "${address}" — no matching address found in US Census records.`,
    );
  }

  return {
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    matchedAddress: match.matchedAddress,
  };
}
