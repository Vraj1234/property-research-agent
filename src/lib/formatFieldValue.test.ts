import { describe, expect, it } from "vitest";
import { formatFieldValue } from "./formatFieldValue";
import type { FieldResult } from "./types";

function field<T>(overrides: Partial<FieldResult<T>>): FieldResult<T> {
  return { field: "hvacType" as never, value: null, source: null, confidence: null, ...overrides };
}

describe("formatFieldValue", () => {
  it("returns 'Not found' for a null value regardless of field type", () => {
    expect(formatFieldValue(field({ field: "propertyTaxAmount" }))).toBe("Not found");
  });

  it("formats a full bed/bath count", () => {
    expect(
      formatFieldValue(field({ field: "bedBathCount", value: { bedrooms: 3, bathrooms: 2 } })),
    ).toBe("3 bed / 2 bath");
  });

  it("formats a partial bed/bath count with only bathrooms known", () => {
    expect(
      formatFieldValue(field({ field: "bedBathCount", value: { bedrooms: null, bathrooms: 32.5 } })),
    ).toBe("32.5 bath");
  });

  it("formats square footage with thousands separators", () => {
    expect(formatFieldValue(field({ field: "squareFootage", value: 1878 }))).toBe("1,878 sqft");
  });

  it("formats year built as a plain number", () => {
    expect(formatFieldValue(field({ field: "yearBuilt", value: 1973 }))).toBe("1973");
  });

  it("joins multiple owner names", () => {
    expect(
      formatFieldValue(field({ field: "ownerName", value: ["Jane Doe", "John Doe"] })),
    ).toBe("Jane Doe, John Doe");
  });

  it("formats property tax as annual currency", () => {
    expect(formatFieldValue(field({ field: "propertyTaxAmount", value: 4164 }))).toBe("$4,164/yr");
  });

  it("formats a distance with a named location", () => {
    expect(
      formatFieldValue(
        field({ field: "nearestFireStationDistance", value: { distanceMiles: 1.2, name: "Station 6" } }),
      ),
    ).toBe("1.2 mi — Station 6");
  });

  it("formats a distance with no name (typical for hydrants)", () => {
    expect(
      formatFieldValue(field({ field: "nearestFireHydrantDistance", value: { distanceMiles: 0.1, name: null } })),
    ).toBe("0.1 mi");
  });

  it("passes plain string fields through unchanged", () => {
    expect(formatFieldValue(field({ field: "hvacType", value: "Central" }))).toBe("Central");
  });
});
