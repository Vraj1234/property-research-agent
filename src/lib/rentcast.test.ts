import { describe, expect, it, vi, afterEach } from "vitest";
import { getPropertyRecord, RentCastError } from "./rentcast";

describe("getPropertyRecord", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps a full RentCast record, picking the most recent tax year and combining heating/cooling", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            bedrooms: 3,
            bathrooms: 2,
            squareFootage: 1878,
            yearBuilt: 1973,
            lastSaleDate: "2024-11-18T00:00:00.000Z",
            owner: { names: ["Rolando Villarreal", "Maria Teresa Loredo Villarreal"] },
            features: { heating: true, heatingType: "Forced Air", cooling: true, coolingType: "Central" },
            propertyTaxes: {
              "2023": { year: 2023, total: 4240 },
              "2024": { year: 2024, total: 4079 },
              "2015": { year: 2015, total: 2716 },
            },
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await getPropertyRecord("5500 Grand Lake Dr, San Antonio, TX 78244");

    expect(result).toEqual({
      bedBathCount: { bedrooms: 3, bathrooms: 2 },
      squareFootage: 1878,
      yearBuilt: 1973,
      ownerNames: ["Rolando Villarreal", "Maria Teresa Loredo Villarreal"],
      hvacType: "Forced Air heating, Central cooling",
      propertyTaxAmount: 4079,
      lastSaleDate: "2024-11-18T00:00:00.000Z",
    });
  });

  it("maps a sparse record (missing owner/tax/sqft/cooling) to nulls instead of throwing", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            bathrooms: 32.5,
            yearBuilt: 1814,
            features: { heating: true, heatingType: "Forced Air" },
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await getPropertyRecord("1600 Pennsylvania Ave NW, Washington, DC 20500");

    expect(result).toEqual({
      bedBathCount: { bedrooms: null, bathrooms: 32.5 },
      squareFootage: null,
      yearBuilt: 1814,
      ownerNames: null,
      hvacType: "Forced Air heating",
      propertyTaxAmount: null,
      lastSaleDate: null,
    });
  });

  it("returns null when RentCast responds with HTTP 200 and an empty array", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const result = await getPropertyRecord("some geocodable but uncovered address");

    expect(result).toBeNull();
  });

  it("returns null when RentCast responds with HTTP 400 (unmatched/unparseable address)", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 400,
          error: "resource/bad-request",
          message: "The provided address could not be parsed or geolocated",
        }),
        { status: 400 },
      ),
    );

    const result = await getPropertyRecord("zzqxx not a real place 999999");

    expect(result).toBeNull();
  });

  it("returns null when RentCast responds with HTTP 404 (valid address, no property data)", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));

    const result = await getPropertyRecord("350 Fifth Avenue, New York, NY 10118");

    expect(result).toBeNull();
  });

  it("throws RentCastError on a non-400 non-OK HTTP response", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));

    await expect(getPropertyRecord("123 Main St")).rejects.toMatchObject({
      name: "RentCastError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws RentCastError when the network request itself fails", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "test-key");
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(getPropertyRecord("123 Main St")).rejects.toBeInstanceOf(RentCastError);
  });

  it("throws RentCastError when RENTCAST_API_KEY is not configured", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "");

    await expect(getPropertyRecord("123 Main St")).rejects.toMatchObject({
      name: "RentCastError",
      code: "UPSTREAM_ERROR",
    });
  });
});
