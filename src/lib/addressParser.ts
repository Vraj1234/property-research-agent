import OpenAI from "openai";

/**
 * gpt-4o-mini (the model discussion.md originally costed this against) was
 * deprecated by OpenAI sometime before this ticket — gpt-5-nano is the
 * current cheapest actively-supported model, and more than capable for a
 * narrow, well-bounded extraction task like this one (PRD.md §6 — the only
 * place natural language parsing is the actual job). See decisions.md
 * 2026-08-27.
 */
const ADDRESS_PARSE_MODEL = "gpt-5-nano";

const SYSTEM_PROMPT =
  "Extract a single US postal address (street, city, state, and zip if present) from the " +
  "user's message and normalize it into one clean address line suitable for a geocoder. " +
  "If the message does not contain an identifiable US address, set found to false and leave " +
  "address as an empty string.";

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    found: { type: "boolean" as const },
    address: { type: "string" as const },
  },
  required: ["found", "address"],
  additionalProperties: false as const,
};

export type AddressParseErrorCode = "UPSTREAM_ERROR";

/** Thrown for a genuine OpenAI failure — missing config, network error, a
 * non-2xx response, or an unparsable body. A message that simply doesn't
 * contain an address is NOT this — `parseAddressFromMessage` returns `null`
 * for that, an honest, expected outcome. */
export class AddressParseError extends Error {
  constructor(
    public readonly code: AddressParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AddressParseError";
  }
}

interface ExtractionResult {
  found: boolean;
  address: string;
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AddressParseError("UPSTREAM_ERROR", "OPENAI_API_KEY is not configured.");
  }
  cachedClient ??= new OpenAI({ apiKey });
  return cachedClient;
}

/**
 * Extracts and normalizes a single US address out of a free-text chat
 * message via OpenAI — the only LLM-driven step in the pipeline besides
 * follow-up Q&A (PRD.md §6). Returns `null` when the message doesn't
 * contain an identifiable US address, so the caller can ask the user to
 * clarify rather than sending garbage into the geocoder.
 */
export async function parseAddressFromMessage(message: string): Promise<string | null> {
  const client = getClient();

  let responseText: string;
  try {
    const response = await client.responses.create({
      model: ADDRESS_PARSE_MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "address_extraction",
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    });
    responseText = response.output_text;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error.";
    throw new AddressParseError("UPSTREAM_ERROR", `OpenAI address parsing failed: ${detail}`);
  }

  let parsed: ExtractionResult;
  try {
    parsed = JSON.parse(responseText) as ExtractionResult;
  } catch {
    throw new AddressParseError(
      "UPSTREAM_ERROR",
      "OpenAI returned a response that could not be parsed as JSON.",
    );
  }

  return parsed.found && parsed.address.trim() !== "" ? parsed.address.trim() : null;
}
