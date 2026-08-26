import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./parallel", async () => {
  const actual = await vi.importActual<typeof import("./parallel")>("./parallel");
  return { ...actual, runParallelTask: vi.fn() };
});

import { runParallelTask, type ParallelJsonSchema, type ParallelProcessor } from "./parallel";
import { webResearchFallback } from "./webResearchFallback";
import type { BedBathCount, FieldResult } from "./types";

function schemaKeys(schema: ParallelJsonSchema): string[] {
  return Object.keys(schema.properties);
}

/** Routes the mocked runParallelTask by which property key its schema asks
 * for, so tests don't depend on Promise.all's internal call ordering. */
function mockRoutedBy(
  handlers: Record<string, (processor: ParallelProcessor) => { content: Record<string, unknown>; confidenceByField: Record<string, string> }>,
) {
  vi.mocked(runParallelTask).mockImplementation(async (_input, schema, processor) => {
    const key = schemaKeys(schema).find((k) => handlers[k]);
    if (!key) throw new Error(`No mock handler for schema keys: ${schemaKeys(schema).join(",")}`);
    return handlers[key](processor) as never;
  });
}

const notFound = { content: {}, confidenceByField: {} };

function field<T>(overrides: Partial<FieldResult<T>>): FieldResult<T> {
  return { field: "hvacType" as never, value: null, source: null, confidence: null, ...overrides };
}

function baseFields(overrides: Record<string, FieldResult> = {}): FieldResult[] {
  const defaults: Record<string, FieldResult> = {
    bedBathCount: field<BedBathCount>({ field: "bedBathCount" }),
    squareFootage: field<number>({ field: "squareFootage" }),
    yearBuilt: field<number>({ field: "yearBuilt" }),
    ownerName: field<string[]>({ field: "ownerName" }),
    hvacType: field<string>({ field: "hvacType" }),
    propertyTaxAmount: field<number>({ field: "propertyTaxAmount" }),
  };
  return Object.values({ ...defaults, ...overrides });
}

describe("webResearchFallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("leaves every field untouched when RentCast already has values and no recent sale", async () => {
    const fields = baseFields({
      bedBathCount: field<BedBathCount>({
        field: "bedBathCount",
        value: { bedrooms: 3, bathrooms: 2 },
        source: "RentCast",
        confidence: "high",
      }),
      squareFootage: field<number>({ field: "squareFootage", value: 1878, source: "RentCast", confidence: "high" }),
      yearBuilt: field<number>({ field: "yearBuilt", value: 1973, source: "RentCast", confidence: "high" }),
      ownerName: field<string[]>({ field: "ownerName", value: ["Jane Doe"], source: "RentCast", confidence: "high" }),
      hvacType: field<string>({ field: "hvacType", value: "Central", source: "RentCast", confidence: "high" }),
      propertyTaxAmount: field<number>({ field: "propertyTaxAmount", value: 4079, source: "RentCast", confidence: "high" }),
    });
    mockRoutedBy({ mortgagee: () => notFound });

    const result = await webResearchFallback("addr", fields, "2015-01-01T00:00:00.000Z");

    // Only mortgagee should have triggered a call — everything else was
    // already populated and the sale is well outside the recency window.
    expect(runParallelTask).toHaveBeenCalledTimes(1);
    expect(result.find((f) => f.field === "bedBathCount")).toEqual(fields.find((f) => f.field === "bedBathCount"));
    expect(result.find((f) => f.field === "squareFootage")).toEqual(fields.find((f) => f.field === "squareFootage"));
  });

  it("null-fills owner name and appends a 'found nothing' note when Parallel.ai also can't find it", async () => {
    mockRoutedBy({
      mortgagee: () => notFound,
      ownerNames: () => ({ content: { ownerNames: "NOT_FOUND" }, confidenceByField: {} }),
    });

    const result = await webResearchFallback("addr", baseFields(), null);

    const owner = result.find((f) => f.field === "ownerName");
    expect(owner?.value).toBeNull();
    expect(owner?.note).toMatch(/parallel\.ai fallback also found nothing/i);
  });

  it("treats an array wrapping only the NOT_FOUND sentinel as not-found, not as a real owner name", async () => {
    // Live-tested 2026-08-26: Parallel.ai returned ["NOT_FOUND"] rather than
    // [] or omitting the key when asked for an array it couldn't fill.
    mockRoutedBy({
      mortgagee: () => notFound,
      ownerNames: () => ({ content: { ownerNames: ["NOT_FOUND"] }, confidenceByField: { ownerNames: "low" } }),
    });

    const result = await webResearchFallback("addr", baseFields(), null);

    const owner = result.find((f) => f.field === "ownerName");
    expect(owner?.value).toBeNull();
    expect(owner?.source).toBeNull();
    expect(owner?.note).toMatch(/parallel\.ai fallback also found nothing/i);
  });

  it("null-fills owner name with a real value and confidence when Parallel.ai finds one", async () => {
    mockRoutedBy({
      mortgagee: () => notFound,
      ownerNames: () => ({ content: { ownerNames: ["Rolando Villarreal"] }, confidenceByField: { ownerNames: "medium" } }),
    });

    const result = await webResearchFallback("addr", baseFields(), null);

    expect(result.find((f) => f.field === "ownerName")).toEqual({
      field: "ownerName",
      value: ["Rolando Villarreal"],
      source: "Parallel.ai",
      confidence: "medium",
    });
  });

  it("null-fills mortgagee (a field RentCast never supplies) and defaults to base tier", async () => {
    mockRoutedBy({
      mortgagee: (processor) => {
        expect(processor).toBe("base");
        return { content: { mortgagee: "Wells Fargo" }, confidenceByField: { mortgagee: "low" } };
      },
    });

    const result = await webResearchFallback("addr", baseFields(), null);

    expect(result.find((f) => f.field === "mortgagee")).toEqual({
      field: "mortgagee",
      value: "Wells Fargo",
      source: "Parallel.ai",
      confidence: "low",
    });
  });

  it("uses core tier for mortgagee when deepResearch is enabled", async () => {
    mockRoutedBy({
      mortgagee: (processor) => {
        expect(processor).toBe("core");
        return notFound;
      },
    });

    await webResearchFallback("addr", baseFields(), null, { deepResearch: true });

    expect(runParallelTask).toHaveBeenCalledWith(expect.any(String), expect.anything(), "core");
  });

  it("treats a numeric field's omitted key as not-found, not as zero", async () => {
    mockRoutedBy({
      mortgagee: () => notFound,
      propertyTaxAmount: () => ({ content: {}, confidenceByField: {} }),
    });

    const result = await webResearchFallback("addr", baseFields(), null);

    const tax = result.find((f) => f.field === "propertyTaxAmount");
    expect(tax?.value).toBeNull();
    expect(tax?.note).toMatch(/found nothing/i);
  });

  it("keeps a RentCast value unchanged (not overwritten with an error note) if a Parallel.ai call throws", async () => {
    vi.mocked(runParallelTask).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const fields = baseFields({
      hvacType: field<string>({ field: "hvacType", value: "Central", source: "RentCast", confidence: "high" }),
    });

    const result = await webResearchFallback("addr", fields, null);

    expect(result.find((f) => f.field === "hvacType")).toEqual(
      fields.find((f) => f.field === "hvacType"),
    );
  });

  it("adds a 'fallback also failed' note when a Parallel.ai call throws for an already-null field", async () => {
    vi.mocked(runParallelTask).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await webResearchFallback("addr", baseFields(), null);

    const mortgagee = result.find((f) => f.field === "mortgagee");
    expect(mortgagee?.note).toMatch(/parallel\.ai fallback also failed to run/i);
  });

  describe("bed/bath/sqft cross-check", () => {
    it("null-fills both bed/bath and sqft together in one call when RentCast had neither", async () => {
      mockRoutedBy({
        mortgagee: () => notFound,
        bedrooms: () => ({
          content: { bedrooms: 3, bathrooms: 2, squareFootage: 1500 },
          confidenceByField: { bedrooms: "medium", squareFootage: "medium" },
        }),
      });

      const result = await webResearchFallback("addr", baseFields(), null);

      expect(result.find((f) => f.field === "bedBathCount")?.value).toEqual({ bedrooms: 3, bathrooms: 2 });
      expect(result.find((f) => f.field === "squareFootage")?.value).toBe(1500);
    });

    it("does not touch bed/bath/sqft when RentCast has values and the sale is old", async () => {
      const fields = baseFields({
        bedBathCount: field<BedBathCount>({
          field: "bedBathCount",
          value: { bedrooms: 3, bathrooms: 2 },
          source: "RentCast",
          confidence: "high",
        }),
        squareFootage: field<number>({ field: "squareFootage", value: 1878, source: "RentCast", confidence: "high" }),
      });
      mockRoutedBy({
        mortgagee: () => notFound,
        yearBuilt: () => notFound,
        ownerNames: () => notFound,
        hvacType: () => notFound,
        propertyTaxAmount: () => notFound,
      });

      await webResearchFallback("addr", fields, "2015-01-01T00:00:00.000Z");

      expect(vi.mocked(runParallelTask).mock.calls.some((c) => schemaKeys(c[1]).includes("bedrooms"))).toBe(false);
    });

    it("overrides a stale RentCast bed/bath figure when a recent sale's cross-check disagrees", async () => {
      const recentSale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fields = baseFields({
        bedBathCount: field<BedBathCount>({
          field: "bedBathCount",
          value: { bedrooms: 3, bathrooms: 2 },
          source: "RentCast",
          confidence: "high",
        }),
        squareFootage: field<number>({ field: "squareFootage", value: 1878, source: "RentCast", confidence: "high" }),
      });
      mockRoutedBy({
        mortgagee: () => notFound,
        bedrooms: () => ({
          content: { bedrooms: 4, bathrooms: 2, squareFootage: 2100 },
          confidenceByField: { bedrooms: "medium", squareFootage: "medium" },
        }),
      });

      const result = await webResearchFallback("addr", fields, recentSale);

      const bedBath = result.find((f) => f.field === "bedBathCount");
      expect(bedBath?.value).toEqual({ bedrooms: 4, bathrooms: 2 });
      expect(bedBath?.source).toBe("Parallel.ai (portal cross-check)");
      expect(bedBath?.note).toMatch(/may be outdated/i);

      const sqft = result.find((f) => f.field === "squareFootage");
      expect(sqft?.value).toBe(2100);
      expect(sqft?.source).toBe("Parallel.ai (portal cross-check)");
    });

    it("leaves RentCast's bed/bath/sqft alone when a recent-sale cross-check agrees with it", async () => {
      const recentSale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fields = baseFields({
        bedBathCount: field<BedBathCount>({
          field: "bedBathCount",
          value: { bedrooms: 3, bathrooms: 2 },
          source: "RentCast",
          confidence: "high",
        }),
        squareFootage: field<number>({ field: "squareFootage", value: 1878, source: "RentCast", confidence: "high" }),
      });
      mockRoutedBy({
        mortgagee: () => notFound,
        bedrooms: () => ({
          content: { bedrooms: 3, bathrooms: 2, squareFootage: 1878 },
          confidenceByField: { bedrooms: "high", squareFootage: "high" },
        }),
      });

      const result = await webResearchFallback("addr", fields, recentSale);

      expect(result.find((f) => f.field === "bedBathCount")).toEqual(fields.find((f) => f.field === "bedBathCount"));
      expect(result.find((f) => f.field === "squareFootage")).toEqual(fields.find((f) => f.field === "squareFootage"));
    });
  });
});
