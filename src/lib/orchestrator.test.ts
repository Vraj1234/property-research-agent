import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("./geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("./rentcast", async () => {
  const actual = await vi.importActual<typeof import("./rentcast")>("./rentcast");
  return { ...actual, getPropertyRecord: vi.fn() };
});

import { geocodeAddress } from "./geocode";
import { getPropertyRecord, RentCastError } from "./rentcast";
import { researchAddress } from "./orchestrator";

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a full RentCast record into RentCast-sourced, high-confidence fields", async () => {
    vi.mocked(getPropertyRecord).mockResolvedValue({
      bedBathCount: { bedrooms: 3, bathrooms: 2 },
      squareFootage: 1878,
      yearBuilt: 1973,
      ownerNames: ["Jane Doe"],
      hvacType: "Forced Air heating, Central cooling",
      propertyTaxAmount: 4079,
      lastSaleDate: "2024-11-18T00:00:00.000Z",
    });

    const result = await researchAddress("5500 Grand Lake Dr, San Antonio, TX 78244");

    expect(result.geocode).toEqual(mockGeocode);
    expect(result.fields).toEqual([
      { field: "bedBathCount", value: { bedrooms: 3, bathrooms: 2 }, source: "RentCast", confidence: "high" },
      { field: "squareFootage", value: 1878, source: "RentCast", confidence: "high" },
      { field: "yearBuilt", value: 1973, source: "RentCast", confidence: "high" },
      { field: "ownerName", value: ["Jane Doe"], source: "RentCast", confidence: "high" },
      { field: "hvacType", value: "Forced Air heating, Central cooling", source: "RentCast", confidence: "high" },
      { field: "propertyTaxAmount", value: 4079, source: "RentCast", confidence: "high" },
    ]);
  });

  it("marks a partial bed/bath count as medium confidence, not high", async () => {
    vi.mocked(getPropertyRecord).mockResolvedValue({
      bedBathCount: { bedrooms: null, bathrooms: 32.5 },
      squareFootage: null,
      yearBuilt: 1814,
      ownerNames: null,
      hvacType: "Forced Air heating",
      propertyTaxAmount: null,
      lastSaleDate: null,
    });

    const result = await researchAddress("1600 Pennsylvania Ave NW, Washington, DC 20500");

    expect(result.fields.find((f) => f.field === "bedBathCount")).toEqual({
      field: "bedBathCount",
      value: { bedrooms: null, bathrooms: 32.5 },
      source: "RentCast",
      confidence: "medium",
    });
  });

  it("honestly marks every RentCast field as not-found, with a note, when no record exists", async () => {
    vi.mocked(getPropertyRecord).mockResolvedValue(null);

    const result = await researchAddress("some address with no RentCast coverage");

    expect(result.geocode).toEqual(mockGeocode);
    expect(result.fields.map((f) => f.field)).toEqual(RENTCAST_FIELD_KEYS);
    for (const field of result.fields) {
      expect(field.value).toBeNull();
      expect(field.source).toBeNull();
      expect(field.confidence).toBeNull();
      expect(field.note).toMatch(/no rentcast property record/i);
    }
  });

  it("degrades to honest not-found fields (not a thrown error) when RentCast itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPropertyRecord).mockRejectedValue(
      new RentCastError("UPSTREAM_ERROR", "RentCast API returned HTTP 500."),
    );

    const result = await researchAddress("123 Main St");

    expect(result.geocode).toEqual(mockGeocode);
    expect(result.fields.map((f) => f.field)).toEqual(RENTCAST_FIELD_KEYS);
    for (const field of result.fields) {
      expect(field.value).toBeNull();
      expect(field.note).toMatch(/rentcast lookup failed/i);
    }
  });

  it("still propagates a geocoding failure unchanged (Ticket 2 behavior)", async () => {
    vi.mocked(geocodeAddress).mockRejectedValue(new Error("geocode boom"));

    await expect(researchAddress("bad address")).rejects.toThrow("geocode boom");
  });
});
