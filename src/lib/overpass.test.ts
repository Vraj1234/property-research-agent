import { describe, expect, it, vi, afterEach } from "vitest";
import { queryNearbyNodes, OverpassError } from "./overpass";

describe("queryNearbyNodes", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("maps matching elements, defaulting a missing name tag to null", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            { lat: 29.45, lon: -98.49, tags: { name: "San Antonio Fire Department Station 6" } },
            { lat: 29.5, lon: -98.4 },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000);

    expect(result).toEqual([
      { lat: 29.45, lon: -98.49, name: "San Antonio Fire Department Station 6" },
      { lat: 29.5, lon: -98.4, name: null },
    ]);
  });

  it("returns an empty array (not an error) when nothing is found nearby", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200 }));

    const result = await queryNearbyNodes(29.476, -98.351, "emergency", "fire_hydrant", 3_000);

    expect(result).toEqual([]);
  });

  it("sends the query as a POST body containing the tag, value, radius, and coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    global.fetch = fetchMock;

    await queryNearbyNodes(29.476, -98.351, "emergency", "fire_hydrant", 3000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    const body = decodeURIComponent((init.body as string).replace(/^data=/, ""));
    expect(body).toContain('"emergency"="fire_hydrant"');
    expect(body).toContain("around:3000,29.476,-98.351");
  });

  it("throws OverpassError on a non-OK HTTP response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 504 }));

    await expect(queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000)).rejects.toMatchObject({
      name: "OverpassError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws OverpassError when the network request itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000),
    ).rejects.toBeInstanceOf(OverpassError);
  });

  it("throws OverpassError when the response body isn't valid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000),
    ).rejects.toBeInstanceOf(OverpassError);
  });
});
