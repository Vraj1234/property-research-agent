import { describe, expect, it, vi, afterEach } from "vitest";
import { geocodeAddress, GeocodingError } from "./geocode";

describe("geocodeAddress", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns coordinates for a matched address", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                coordinates: { x: -77.035, y: 38.898 },
                matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const result = await geocodeAddress("1600 Pennsylvania Ave NW, Washington, DC 20500");

    expect(result).toEqual({
      latitude: 38.898,
      longitude: -77.035,
      matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
    });
  });

  it("throws GeocodingError(NO_MATCH) when no address matches are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 }),
    );

    await expect(geocodeAddress("not a real place")).rejects.toMatchObject({
      name: "GeocodingError",
      code: "NO_MATCH",
    });
  });

  it("throws GeocodingError(UPSTREAM_ERROR) on a non-OK HTTP response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));

    await expect(geocodeAddress("123 Main St")).rejects.toMatchObject({
      name: "GeocodingError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws GeocodingError(UPSTREAM_ERROR) when the network request itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(geocodeAddress("123 Main St")).rejects.toBeInstanceOf(GeocodingError);
  });
});
