import { describe, expect, it, vi, afterEach } from "vitest";
import type { ResearchResult } from "./types";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function MockOpenAI() {
    return { responses: { create: mockCreate } };
  }),
}));

async function freshModule() {
  vi.resetModules();
  return import("./followUp");
}

const sampleResult: ResearchResult = {
  input: { address: "5500 Grand Lake Dr, San Antonio, TX 78244", deepResearch: false },
  geocode: { latitude: 29.48, longitude: -98.35, matchedAddress: "5500 GRAND LAKE, SAN ANTONIO, TX 78244" },
  fields: [
    { field: "yearBuilt", value: 1973, source: "RentCast", confidence: "high" },
    { field: "mortgagee", value: null, source: null, confidence: null, note: "RentCast does not report mortgage/lender data." },
  ],
  notices: [],
};

describe("answerFollowUp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the model's trimmed answer text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({ output_text: "  It was built in 1973.  " });
    const { answerFollowUp } = await freshModule();

    const answer = await answerFollowUp("how old is the house", sampleResult);

    expect(answer).toBe("It was built in 1973.");
  });

  it("includes the address and fields as context in the request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({ output_text: "answer" });
    const { answerFollowUp } = await freshModule();

    await answerFollowUp("who owns it", sampleResult);

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.input.find((m: { role: string }) => m.role === "user").content as string;
    expect(userMessage).toContain("5500 GRAND LAKE");
    expect(userMessage).toContain("yearBuilt");
    expect(userMessage).toContain("who owns it");
  });

  it("throws FollowUpError when OPENAI_API_KEY is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { answerFollowUp, FollowUpError } = await freshModule();

    await expect(answerFollowUp("q", sampleResult)).rejects.toBeInstanceOf(FollowUpError);
  });

  it("throws FollowUpError when the OpenAI call itself fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockRejectedValue(new Error("rate limited"));
    const { answerFollowUp, FollowUpError } = await freshModule();

    await expect(answerFollowUp("q", sampleResult)).rejects.toBeInstanceOf(FollowUpError);
  });
});
