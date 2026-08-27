import { describe, expect, it, vi, afterEach } from "vitest";
import { getAddressSuggestions, PhotonError } from "./photon";

function photonResponse(features: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify({ features }), { status: 200 });
}

function feature(properties: Record<string, unknown>) {
  return { properties };
}

describe("getAddressSuggestions", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("formats a US house-level result into a single-line label", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      photonResponse([
        feature({
          osm_id: 19761182,
          housenumber: "1600",
          street: "Pennsylvania Avenue Northwest",
          city: "Washington",
          state: "District of Columbia",
          postcode: "20500",
          countrycode: "US",
        }),
      ]),
    );

    const result = await getAddressSuggestions("1600 Pennsylvania Ave");

    expect(result).toEqual([
      {
        id: "19761182",
        label: "1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500",
      },
    ]);
  });

  it("excludes non-US results", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      photonResponse([
        feature({
          osm_id: 1,
          housenumber: "10",
          street: "Downing Street",
          city: "London",
          countrycode: "GB",
        }),
      ]),
    );

    const result = await getAddressSuggestions("10 Downing");

    expect(result).toEqual([]);
  });

  it("excludes results with no house number or street — not specific enough to be a mailing address", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      photonResponse([
        feature({ osm_id: 1, city: "Austin", state: "Texas", countrycode: "US" }),
        feature({ osm_id: 2, street: "Congress Avenue", city: "Austin", countrycode: "US" }),
      ]),
    );

    const result = await getAddressSuggestions("Austin");

    expect(result).toEqual([]);
  });

  it("de-duplicates results that format to the identical label", async () => {
    const duplicate = {
      housenumber: "1600",
      street: "Pennsylvania Avenue Northwest",
      city: "Washington",
      state: "District of Columbia",
      postcode: "20500",
      countrycode: "US",
    };
    global.fetch = vi.fn().mockResolvedValue(
      photonResponse([feature({ osm_id: 1, ...duplicate }), feature({ osm_id: 2, ...duplicate })]),
    );

    const result = await getAddressSuggestions("1600 Pennsylvania Ave");

    expect(result).toHaveLength(1);
  });

  it("returns an empty array (not an error) when nothing matches", async () => {
    global.fetch = vi.fn().mockResolvedValue(photonResponse([]));

    const result = await getAddressSuggestions("zzqxx not a real place");

    expect(result).toEqual([]);
  });

  it("throws PhotonError on a network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(getAddressSuggestions("123 Main St")).rejects.toBeInstanceOf(PhotonError);
  });

  it("throws PhotonError on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));

    await expect(getAddressSuggestions("123 Main St")).rejects.toThrow(/HTTP 503/);
  });

  it("throws PhotonError on an unparsable response body", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(getAddressSuggestions("123 Main St")).rejects.toBeInstanceOf(PhotonError);
  });
});
