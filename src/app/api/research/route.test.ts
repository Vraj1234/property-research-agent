import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/addressParser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/addressParser")>("@/lib/addressParser");
  return { ...actual, parseAddressFromMessage: vi.fn() };
});
vi.mock("@/lib/geocode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geocode")>("@/lib/geocode");
  return { ...actual, geocodeAddress: vi.fn() };
});
vi.mock("@/lib/orchestrator", () => ({ researchFields: vi.fn() }));
vi.mock("@/lib/followUp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/followUp")>("@/lib/followUp");
  return { ...actual, answerFollowUp: vi.fn() };
});

import { parseAddressFromMessage, AddressParseError } from "@/lib/addressParser";
import { geocodeAddress, GeocodingError } from "@/lib/geocode";
import { researchFields } from "@/lib/orchestrator";
import { answerFollowUp, FollowUpError } from "@/lib/followUp";
import type { FieldResult, GeocodeResult, ResearchResult, ResearchStreamEvent } from "@/lib/types";
import { POST } from "./route";

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Reads a `Response` whose body is an SSE stream (the success path, since
 * Ticket 9) into the ordered list of decoded `ResearchStreamEvent`s. */
async function readSseEvents(response: Response): Promise<ResearchStreamEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: ResearchStreamEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine) events.push(JSON.parse(dataLine.slice(5).trim()));
    }
  }

  return events;
}

const mockGeocode: GeocodeResult = { latitude: 38.9, longitude: -77.03, matchedAddress: "1600 PENNSYLVANIA AVE NW" };

const mockResult: ResearchResult = {
  input: { address: "1600 Pennsylvania Ave NW, Washington, DC 20500", deepResearch: false },
  geocode: mockGeocode,
  fields: [{ field: "yearBuilt", value: 1814, source: "RentCast", confidence: "high" }],
  notices: [],
};

describe("POST /api/research", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("parses the message, geocodes it, and streams a geocode event, each field, then a done event", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("1600 Pennsylvania Ave NW, Washington, DC 20500");
    vi.mocked(geocodeAddress).mockResolvedValue(mockGeocode);
    const yearBuilt: FieldResult = { field: "yearBuilt", value: 1814, source: "RentCast", confidence: "high" };
    vi.mocked(researchFields).mockImplementation(async (_address, _geocode, _options, onFieldResolved) => {
      onFieldResolved?.(yearBuilt);
      return { fields: [yearBuilt], notices: [] };
    });

    const response = await POST(postRequest({ message: "look up the white house for me" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await readSseEvents(response);
    expect(events).toEqual([
      { type: "geocode", geocode: mockGeocode },
      { type: "field", field: yearBuilt },
      {
        type: "done",
        result: {
          input: { address: "1600 Pennsylvania Ave NW, Washington, DC 20500", deepResearch: false },
          geocode: mockGeocode,
          fields: [yearBuilt],
          notices: [],
        },
      },
    ]);
    expect(parseAddressFromMessage).toHaveBeenCalledWith("look up the white house for me");
    expect(geocodeAddress).toHaveBeenCalledWith("1600 Pennsylvania Ave NW, Washington, DC 20500");
    expect(researchFields).toHaveBeenCalledWith(
      "1600 Pennsylvania Ave NW, Washington, DC 20500",
      mockGeocode,
      { deepResearch: false },
      expect.any(Function),
    );
  });

  it("returns 422 NO_ADDRESS_FOUND when no address is found and there's no previous result to fall back on", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue(null);

    const response = await POST(postRequest({ message: "what's the weather like today" }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_ADDRESS_FOUND");
    expect(geocodeAddress).not.toHaveBeenCalled();
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
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(body).toEqual({ type: "answer", answer: "It was built in 1814." });
    expect(answerFollowUp).toHaveBeenCalledWith("how old is the house", mockResult);
    expect(geocodeAddress).not.toHaveBeenCalled();
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
    vi.mocked(geocodeAddress).mockResolvedValue(mockGeocode);
    vi.mocked(researchFields).mockResolvedValue({ fields: [], notices: [] });

    const response = await POST(postRequest({ message: "123 Main St", deepResearch: true }));
    await readSseEvents(response); // drain the stream so the handler finishes

    expect(researchFields).toHaveBeenCalledWith(
      "123 Main St",
      mockGeocode,
      { deepResearch: true },
      expect.any(Function),
    );
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

  it("maps a geocoding NO_MATCH to 422 and an UPSTREAM_ERROR to 502, before any streaming starts", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("zzqxx not a real place");
    vi.mocked(geocodeAddress).mockRejectedValue(new GeocodingError("NO_MATCH", "Could not geocode."));

    const response = await POST(postRequest({ message: "zzqxx not a real place" }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_MATCH");
    expect(researchFields).not.toHaveBeenCalled();
  });

  it("returns 500 for an unexpected geocoding failure, before any streaming starts", async () => {
    vi.mocked(parseAddressFromMessage).mockResolvedValue("123 Main St");
    vi.mocked(geocodeAddress).mockRejectedValue(new Error("boom"));

    const response = await POST(postRequest({ message: "123 Main St" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(researchFields).not.toHaveBeenCalled();
  });

  it("reports an unexpected mid-stream pipeline error as a stream error event, not an HTTP status (response already committed to 200)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(parseAddressFromMessage).mockResolvedValue("123 Main St");
    vi.mocked(geocodeAddress).mockResolvedValue(mockGeocode);
    vi.mocked(researchFields).mockRejectedValue(new Error("boom"));

    const response = await POST(postRequest({ message: "123 Main St" }));

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(events).toEqual([
      { type: "geocode", geocode: mockGeocode },
      {
        type: "error",
        code: "UPSTREAM_ERROR",
        message: "Unexpected server error while researching this address.",
      },
    ]);
  });

  it("keeps streaming safely instead of throwing when the client disconnects mid-stream", async () => {
    // Live-reproduced bug: a client that disconnects (tab closed, fetch
    // aborted, a client-side timeout) while researchFields is still
    // running left later onFieldResolved calls trying to enqueue onto an
    // already-closed stream controller, throwing
    // `TypeError [ERR_INVALID_STATE]: Controller is already closed`.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(parseAddressFromMessage).mockResolvedValue("123 Main St");
    vi.mocked(geocodeAddress).mockResolvedValue(mockGeocode);

    let continueAfterDisconnect: (() => void) | undefined;
    const secondFieldReported = new Promise<void>((resolveTest) => {
      vi.mocked(researchFields).mockImplementation(async (_addr, _geo, _opts, onFieldResolved) => {
        onFieldResolved?.({ field: "yearBuilt", value: 1900, source: "RentCast", confidence: "high" });
        await new Promise<void>((resolve) => {
          continueAfterDisconnect = resolve;
        });
        // This is the exact moment the original bug threw: reporting a
        // field after the reader below has already cancelled the stream.
        onFieldResolved?.({ field: "hvacType", value: "Central", source: "RentCast", confidence: "high" });
        resolveTest();
        return { fields: [], notices: [] };
      });
    });

    const response = await POST(postRequest({ message: "123 Main St" }));
    const reader = response.body!.getReader();
    await reader.read(); // the geocode event
    await reader.read(); // the first field event
    await reader.cancel(); // simulates the client disconnecting

    continueAfterDisconnect?.();
    await secondFieldReported;

    // The real assertion: no unhandled exception, and no error logged for
    // what should now be a silent no-op.
    expect(console.error).not.toHaveBeenCalled();
  });
});
