import { describe, expect, it } from "vitest";
import { ALL_FIELD_KEYS, applyFieldEvent, createPendingFields, resolvedFields } from "./liveField";
import type { FieldResult } from "@/lib/types";

describe("createPendingFields", () => {
  it("seeds all 9 canonical fields as pending", () => {
    const fields = createPendingFields();

    expect(fields).toHaveLength(ALL_FIELD_KEYS.length);
    expect(fields.every((f) => f.status === "pending")).toBe(true);
    expect(fields.map((f) => f.field)).toEqual(ALL_FIELD_KEYS);
  });
});

describe("applyFieldEvent", () => {
  it("marks only the matching field resolved, leaving the rest untouched", () => {
    const before = createPendingFields();
    const yearBuilt: FieldResult = { field: "yearBuilt", value: 1987, source: "RentCast", confidence: "high" };

    const after = applyFieldEvent(before, yearBuilt);

    const resolved = after.find((f) => f.field === "yearBuilt");
    expect(resolved).toEqual({ field: "yearBuilt", status: "resolved", result: yearBuilt });
    expect(after.filter((f) => f.status === "pending")).toHaveLength(ALL_FIELD_KEYS.length - 1);
  });

  it("does not mutate the array it was given", () => {
    const before = createPendingFields();
    const beforeSnapshot = [...before];

    applyFieldEvent(before, { field: "yearBuilt", value: 1987, source: "RentCast", confidence: "high" });

    expect(before).toEqual(beforeSnapshot);
  });
});

describe("resolvedFields", () => {
  it("converts a finished pipeline's flat field list into all-resolved LiveFields, preserving canonical order", () => {
    const pipelineFields: FieldResult[] = [
      { field: "yearBuilt", value: 1987, source: "RentCast", confidence: "high" },
      { field: "ownerName", value: null, source: null, confidence: null, note: "Not found." },
    ];

    const result = resolvedFields(pipelineFields);

    expect(result.map((f) => f.field)).toEqual(ALL_FIELD_KEYS);
    expect(result.find((f) => f.field === "yearBuilt")?.status).toBe("resolved");
  });

  it("honestly marks a field the pipeline never returned, instead of leaving it silently pending", () => {
    const result = resolvedFields([]);

    for (const entry of result) {
      expect(entry.status).toBe("resolved");
      expect(entry.result?.note).toMatch(/wasn't returned/i);
    }
  });
});
