import { describe, expect, it, vi, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  // Must be a regular function, not an arrow function — arrow functions
  // aren't constructible, and addressParser.ts calls `new OpenAI(...)`.
  default: vi.fn().mockImplementation(function MockOpenAI() {
    return { responses: { create: mockCreate } };
  }),
}));

// The module caches its OpenAI client in a module-level singleton (a real
// production optimization — reuse the client across warm invocations), so
// each test gets a fresh module instance via resetModules + dynamic import
// to avoid one test's cached client leaking into the next.
async function freshModule() {
  vi.resetModules();
  return import("./addressParser");
}

describe("parseAddressFromMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the normalized address when one is found", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({
      output_text: JSON.stringify({ found: true, address: "1600 Pennsylvania Ave NW, Washington, DC 20500" }),
    });
    const { parseAddressFromMessage } = await freshModule();

    const result = await parseAddressFromMessage("can you look up the white house for me");

    expect(result).toBe("1600 Pennsylvania Ave NW, Washington, DC 20500");
  });

  it("returns null when the message has no identifiable address", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({ output_text: JSON.stringify({ found: false, address: "" }) });
    const { parseAddressFromMessage } = await freshModule();

    const result = await parseAddressFromMessage("what's the weather like today");

    expect(result).toBeNull();
  });

  it("treats a found=true response with a blank address as not-found", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({ output_text: JSON.stringify({ found: true, address: "   " }) });
    const { parseAddressFromMessage } = await freshModule();

    const result = await parseAddressFromMessage("hmm");

    expect(result).toBeNull();
  });

  it("throws AddressParseError when OPENAI_API_KEY is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { parseAddressFromMessage, AddressParseError } = await freshModule();

    await expect(parseAddressFromMessage("123 Main St")).rejects.toBeInstanceOf(AddressParseError);
  });

  it("throws AddressParseError when the OpenAI call itself fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockRejectedValue(new Error("rate limited"));
    const { parseAddressFromMessage, AddressParseError } = await freshModule();

    await expect(parseAddressFromMessage("123 Main St")).rejects.toBeInstanceOf(AddressParseError);
  });

  it("throws AddressParseError when the response body isn't valid JSON", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockCreate.mockResolvedValue({ output_text: "not json" });
    const { parseAddressFromMessage, AddressParseError } = await freshModule();

    await expect(parseAddressFromMessage("123 Main St")).rejects.toBeInstanceOf(AddressParseError);
  });
});
