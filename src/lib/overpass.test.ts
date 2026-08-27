import { describe, expect, it, vi, afterEach } from "vitest";
import { queryNearbyNodes, OverpassError } from "./overpass";

const PRIMARY_MIRROR = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
const SECONDARY_MIRROR = "https://overpass-api.de/api/interpreter";
const TERTIARY_MIRROR = "https://overpass.private.coffee/api/interpreter";

// 2 attempts per mirror x 3 mirrors, per overpass.ts's ATTEMPTS_PER_MIRROR.
const TOTAL_ATTEMPTS = 6;

describe("queryNearbyNodes", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("maps matching elements from the primary mirror's first attempt, defaulting a missing name tag to null", async () => {
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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array (not an error) when nothing is found nearby", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200 }));

    const result = await queryNearbyNodes(29.476, -98.351, "emergency", "fire_hydrant", 3_000);

    expect(result).toEqual([]);
  });

  it("sends the query to the primary mirror first, as a POST body containing the tag, value, radius, and coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    global.fetch = fetchMock;

    await queryNearbyNodes(29.476, -98.351, "emergency", "fire_hydrant", 3000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PRIMARY_MIRROR);
    const body = decodeURIComponent((init.body as string).replace(/^data=/, ""));
    expect(body).toContain('"emergency"="fire_hydrant"');
    expect(body).toContain("around:3000,29.476,-98.351");
  });

  it("retries the same mirror once before falling back to the next one", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient blip"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    global.fetch = fetchMock;

    const result = await queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both attempts went to the same (primary) mirror — no fallover needed.
    expect(fetchMock.mock.calls[0][0]).toBe(PRIMARY_MIRROR);
    expect(fetchMock.mock.calls[1][0]).toBe(PRIMARY_MIRROR);
  });

  it("falls back to the next mirror only after both attempts on the primary fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [{ lat: 1, lon: 2 }] }), { status: 200 }));
    global.fetch = fetchMock;

    const result = await queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000);

    expect(result).toEqual([{ lat: 1, lon: 2, name: null }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(SECONDARY_MIRROR);
  });

  it("falls back through all three mirrors before succeeding on the last one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    global.fetch = fetchMock;

    const result = await queryNearbyNodes(29.476, -98.351, "emergency", "fire_hydrant", 3_000);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toBe(TERTIARY_MIRROR);
  });

  it("throws OverpassError only once every mirror has exhausted its retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 504 }));
    global.fetch = fetchMock;

    await expect(queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000)).rejects.toMatchObject({
      name: "OverpassError",
      code: "UPSTREAM_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
  });

  it("throws OverpassError when every mirror's network request fails on every attempt", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000),
    ).rejects.toBeInstanceOf(OverpassError);
  });

  it("throws OverpassError when every mirror's response body isn't valid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      queryNearbyNodes(29.476, -98.351, "amenity", "fire_station", 25_000),
    ).rejects.toBeInstanceOf(OverpassError);
  });
});
