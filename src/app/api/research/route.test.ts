import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/addressParser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/addressParser")>("@/lib/addressParser");
  return { ...actual, parseAddressFromMessage: vi.fn() };
});
vi.mock("@/lib/orchestrator", () => ({ researchAddress: vi.fn() }));
vi.mock("@/lib/followUp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/followUp")>("@/lib/followUp");
  return { ...actual, answerFollowUp: vi.fn() };
});

import { parseAddressFromMessage, AddressParseError } from "@/lib/addressParser";
import { researchAddress } from "@/lib/orchestrator";
import { answerFollowUp, FollowUpError } from "@/lib/followUp";
import { GeocodingError } from "@/lib/geocode";
import type { ResearchResult } from "@/lib/types";
import { POST } from "./route";

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const mockResult: ResearchResult = {
  input: { address: "1600 Pennsylvania Ave NW, Washington, DC 20500", deepResearch: false },
  geocode: { latitude: 38.9, longitude: -77.03, matchedAddress: "1600 PENNSYLVANIA AVE NW" },
  fields: [
    { field: "yearBuilt", value: 1814, source: "RentCast", confidence: "high" },
  ],
  notices: [],
};

describe("POST /api/research", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("parses the message into an address, runs the research pipeline, and wraps it as type: research", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("1600 Pennsylvania Ave NW, Washington, DC 20500");
    vi.mocked(researchAddress).mockResolvedValue(mockResult);

    const response = await POST(postRequest({ message: "look up the white house for me" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ type: "research", result: mockResult });
    expect(parseAddressFromMessage).toHaveBeenCalledWith("look up the white house for me");
    expect(researchAddress).toHaveBeenCalledWith("1600 Pennsylvania Ave NW, Washington, DC 20500", {
      deepResearch: undefined,
    });
  });

  it("returns 422 NO_ADDRESS_FOUND when no address is found and there's no previous result to fall back on", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue(null);

    const response = await POST(postRequest({ message: "what's the weather like today" }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_ADDRESS_FOUND");
    expect(researchAddress).not.toHaveBeenCalled();
    expect(answerFollowUp).not.toHaveBeenCalled();
  });

  it("treats a message with no address as a follow-up question when a previousResult is supplied", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue(null);
    vi.mocked(answerFollowUp).mockResolvedValue("It was built in 1814.");

    const response = await POST(
      postRequest({ message: "how old is the house", previousResult: mockResult }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ type: "answer", answer: "It was built in 1814." });
    expect(answerFollowUp).toHaveBeenCalledWith("how old is the house", mockResult);
    expect(researchAddress).not.toHaveBeenCalled();
  });

  it("returns 502 when follow-up answering itself fails", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue(null);
    vi.mocked(answerFollowUp).mockRejectedValue(
      new FollowUpError("UPSTREAM_ERROR", "OpenAI follow-up answering failed: rate limited"),
    );

    const response = await POST(postRequest({ message: "how old is it", previousResult: mockResult }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("rejects a malformed previousResult with 400 INVALID_INPUT rather than passing it through", async () => {
    const response = await POST(
      postRequest({ message: "how old is it", previousResult: { garbage: true } }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(parseAddressFromMessage).not.toHaveBeenCalled();
  });

  it("returns 502 when address parsing itself fails", async () => {
    vi.mocked(parseAddressFromMessage).mockRejectedValue(
      new AddressParseError("UPSTREAM_ERROR", "OpenAI address parsing failed: rate limited"),
    );

    const response = await POST(postRequest({ message: "123 Main St" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("threads deepResearch through to the pipeline", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("123 Main St");
    vi.mocked(researchAddress).mockResolvedValue(mockResult);

    await POST(postRequest({ message: "123 Main St", deepResearch: true }));

    expect(researchAddress).toHaveBeenCalledWith("123 Main St", { deepResearch: true });
  });

  it("returns 400 INVALID_INPUT for an empty message", async () => {
    const response = await POST(postRequest({ message: "" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(parseAddressFromMessage).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT for a non-JSON body", async () => {
    const request = new NextRequest("http://localhost/api/research", {
      method: "POST",
      body: "not json",
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("maps a geocoding NO_MATCH to 422 and an UPSTREAM_ERROR to 502", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("zzqxx not a real place");
    vi.mocked(researchAddress).mockRejectedValue(new GeocodingError("NO_MATCH", "Could not geocode."));

    const response = await POST(postRequest({ message: "zzqxx not a real place" }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_MATCH");
  });

  it("returns 500 for an unexpected pipeline error", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("123 Main St");
    vi.mocked(researchAddress).mockRejectedValue(new Error("boom"));

    const response = await POST(postRequest({ message: "123 Main St" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });
});
