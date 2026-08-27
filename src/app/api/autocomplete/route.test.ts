import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/photon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/photon")>("@/lib/photon");
  return { ...actual, getAddressSuggestions: vi.fn() };
});

import { getAddressSuggestions, PhotonError } from "@/lib/photon";
import { GET } from "./route";

function getRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/autocomplete?q=${encodeURIComponent(query)}`);
}

describe("GET /api/autocomplete", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns Photon's suggestions for a query long enough to search", async () => {
    vi.mocked(getAddressSuggestions).mockResolvedValue([
      { id: "1", label: "1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500" },
    ]);

    const response = await GET(getRequest("1600 Pennsylvania"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      suggestions: [{ id: "1", label: "1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500" }],
    });
    expect(getAddressSuggestions).toHaveBeenCalledWith("1600 Pennsylvania");
  });

  it("returns an empty list without calling Photon at all for a too-short query", async () => {
    const response = await GET(getRequest("16"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
    expect(getAddressSuggestions).not.toHaveBeenCalled();
  });

  it("returns an empty list without calling Photon at all for a missing query", async () => {
    const response = await GET(new NextRequest("http://localhost/api/autocomplete"));
    const body = await response.json();

    expect(body).toEqual({ suggestions: [] });
    expect(getAddressSuggestions).not.toHaveBeenCalled();
  });

  it("degrades to an empty list (still HTTP 200) when Photon itself fails, never an error response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAddressSuggestions).mockRejectedValue(
      new PhotonError("UPSTREAM_ERROR", "Photon API returned HTTP 503."),
    );

    const response = await GET(getRequest("123 Main St"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
  });

  it("degrades to an empty list on a genuinely unexpected error too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAddressSuggestions).mockRejectedValue(new Error("boom"));

    const response = await GET(getRequest("123 Main St"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
  });
});
