import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("./geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("./rentcast", async () => {
  const actual = await vi.importActual<typeof import("./rentcast")>("./rentcast");
  return { ...actual, getPropertyRecord: vi.fn() };
});
vi.mock("./webResearchFallback", () => ({ webResearchFallback: vi.fn() }));

import { geocodeAddress } from "./geocode";
import { getPropertyRecord, RentCastError } from "./rentcast";
import { webResearchFallback } from "./webResearchFallback";
import { researchAddress } from "./orchestrator";
import type { FieldResult } from "./types";

const mockGeocode = { latitude: 29.48, longitude: -98.35, matchedAddress: "1 Main St" };
const RENTCAST_FIELD_KEYS = [
  "bedBathCount",
  "squareFootage",
  "yearBuilt",
  "ownerName",
  "hvacType",
  "propertyTaxAmount",
];

describe("researchAddress", () => {
  beforeEach(() => {
    vi.mocked(geocodeAddress).mockResolvedValue(mockGeocode);
    // By default, echo whatever baseFields the orchestrator built — the
    // fallback layer's own behavior is covered in webResearchFallback.test.ts.
    vi.mocked(webResearchFallback).mockImplementation(async (_address, baseFields) => baseFields);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("passes RentCast's mapped fields into the fallback layer and returns its result", async () => {
    const rentCastRecord = {
      bedBathCount: { bedrooms: 3, bathrooms: 2 },
      squareFootage: 1878,
      yearBuilt: 1973,
      ownerNames: ["Jane Doe"],
      hvacType: "Forced Air heating, Central cooling",
      propertyTaxAmount: 4079,
      lastSaleDate: "2024-11-18T00:00:00.000Z",
    };
    vi.mocked(getPropertyRecord).mockResolvedValue(rentCastRecord);
    const enriched: FieldResult[] = [{ field: "mortgagee", value: "Acme Bank", source: "Parallel.ai", confidence: "medium" }];
    vi.mocked(webResearchFallback).mockResolvedValue(enriched);

    const result = await researchAddress("5500 Grand Lake Dr, San Antonio, TX 78244");

    expect(result.geocode).toEqual(mockGeocode);
    expect(result.fields).toEqual(enriched);
    expect(result.input).toEqual({ address: "5500 Grand Lake Dr, San Antonio, TX 78244", deepResearch: false });
    expect(result.notices).toEqual([]);
    expect(webResearchFallback).toHaveBeenCalledWith(
      "5500 Grand Lake Dr, San Antonio, TX 78244",
      expect.arrayContaining([
        { field: "bedBathCount", value: { bedrooms: 3, bathrooms: 2 }, source: "RentCast", confidence: "high" },
        { field: "ownerName", value: ["Jane Doe"], source: "RentCast", confidence: "high" },
      ]),
      "2024-11-18T00:00:00.000Z",
      { deepResearch: false },
    );
  });

  it("threads deepResearch through to the fallback layer and adds a latency notice", async () => {
    vi.mocked(getPropertyRecord).mockResolvedValue(null);

    const result = await researchAddress("some address", { deepResearch: true });

    expect(result.input.deepResearch).toBe(true);
    expect(result.notices).toEqual([
      "Deep research mode is enabled for mortgagee/owner lookups — this request may take several minutes.",
    ]);
    expect(webResearchFallback).toHaveBeenCalledWith(
      "some address",
      expect.any(Array),
      null,
      { deepResearch: true },
    );
  });

  it("passes RentCast's mapped fields into the fallback layer with honest not-found placeholders when no record exists", async () => {
    vi.mocked(getPropertyRecord).mockResolvedValue(null);

    await researchAddress("some address with no RentCast coverage");

    const [, baseFields, lastSaleDate] = vi.mocked(webResearchFallback).mock.calls[0];
    expect(baseFields.map((f) => f.field)).toEqual(RENTCAST_FIELD_KEYS);
    for (const field of baseFields) {
      expect(field.value).toBeNull();
      expect(field.note).toMatch(/no rentcast property record/i);
    }
    expect(lastSaleDate).toBeNull();
  });

  it("still calls the fallback layer (not just a hard failure) when RentCast itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPropertyRecord).mockRejectedValue(
      new RentCastError("UPSTREAM_ERROR", "RentCast API returned HTTP 500."),
    );

    const result = await researchAddress("123 Main St");

    expect(result.geocode).toEqual(mockGeocode);
    const [, baseFields] = vi.mocked(webResearchFallback).mock.calls[0];
    expect(baseFields.map((f: FieldResult) => f.field)).toEqual(RENTCAST_FIELD_KEYS);
    for (const field of baseFields) {
      expect(field.note).toMatch(/rentcast lookup failed/i);
    }
  });

  it("still propagates a geocoding failure unchanged (Ticket 2 behavior)", async () => {
    vi.mocked(geocodeAddress).mockRejectedValue(new Error("geocode boom"));

    await expect(researchAddress("bad address")).rejects.toThrow("geocode boom");
    expect(webResearchFallback).not.toHaveBeenCalled();
  });
});
