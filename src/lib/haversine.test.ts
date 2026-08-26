import { describe, expect, it } from "vitest";
import { haversineDistanceMiles } from "./haversine";

describe("haversineDistanceMiles", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistanceMiles(29.476, -98.351, 29.476, -98.351)).toBe(0);
  });

  it("matches the well-known ~69 miles per degree of latitude", () => {
    const distance = haversineDistanceMiles(0, 0, 1, 0);
    expect(distance).toBeCloseTo(69.09, 1);
  });

  it("is symmetric", () => {
    const a = haversineDistanceMiles(29.476, -98.351, 38.898, -77.035);
    const b = haversineDistanceMiles(38.898, -77.035, 29.476, -98.351);
    expect(a).toBeCloseTo(b, 10);
  });
});
