import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./overpass", async () => {
  const actual = await vi.importActual<typeof import("./overpass")>("./overpass");
  return { ...actual, queryNearbyNodes: vi.fn() };
});

import { queryNearbyNodes, OverpassError } from "./overpass";
import { distanceFields } from "./distanceFields";

// 5500 Grand Lake Dr, San Antonio, TX — used throughout the project's live tests.
const LAT = 29.476011;
const LON = -98.351454;

describe("distanceFields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("picks the closer of two nodes and reports its name and rounded distance", async () => {
    vi.mocked(queryNearbyNodes).mockImplementation(async (_lat, _lon, tagKey) => {
      if (tagKey === "amenity") {
        return [
          { lat: LAT + 0.2, lon: LON, name: "Far Station" },
          { lat: LAT + 0.01, lon: LON, name: "Near Station" },
        ];
      }
      return [];
    });

    const [fireStation] = await distanceFields(LAT, LON);

    expect(fireStation.field).toBe("nearestFireStationDistance");
    expect(fireStation.source).toBe("OpenStreetMap Overpass");
    expect(fireStation.confidence).toBe("high");
    expect((fireStation.value as { name: string }).name).toBe("Near Station");
    expect((fireStation.value as { distanceMiles: number }).distanceMiles).toBeCloseTo(0.69, 1);
  });

  it("queries fire stations and fire hydrants with their own tag and radius", async () => {
    vi.mocked(queryNearbyNodes).mockResolvedValue([]);

    await distanceFields(LAT, LON);

    expect(queryNearbyNodes).toHaveBeenCalledWith(LAT, LON, "amenity", "fire_station", 25_000);
    expect(queryNearbyNodes).toHaveBeenCalledWith(LAT, LON, "emergency", "fire_hydrant", 3_000);
  });

  it("reports an honest coverage-gap note (not an error) when nothing is found nearby", async () => {
    vi.mocked(queryNearbyNodes).mockResolvedValue([]);

    const [fireStation, fireHydrant] = await distanceFields(LAT, LON);

    for (const field of [fireStation, fireHydrant]) {
      expect(field.value).toBeNull();
      expect(field.source).toBeNull();
      expect(field.note).toMatch(/known coverage gap/i);
    }
  });

  it("degrades to a null value with a failure note (not a thrown error) when Overpass itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(queryNearbyNodes).mockRejectedValue(new OverpassError("UPSTREAM_ERROR", "Overpass API returned HTTP 504."));

    const [fireStation, fireHydrant] = await distanceFields(LAT, LON);

    for (const field of [fireStation, fireHydrant]) {
      expect(field.value).toBeNull();
      expect(field.note).toMatch(/overpass lookup failed/i);
    }
  });
});
