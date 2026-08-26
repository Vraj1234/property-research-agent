import OpenAI from "openai";
import type { ResearchResult } from "./types";

/** Same model as addressParser.ts (gpt-4o-mini is deprecated — see
 * decisions.md 2026-08-27). This is a narrow, grounded Q&A task (answer
 * strictly from the JSON provided, nothing else), well within gpt-5-nano's
 * capability — revisit if Ticket 8 QA shows answer quality is lacking. */
const FOLLOWUP_MODEL = "gpt-5-nano";

const SYSTEM_PROMPT =
  "You are answering a follow-up question about a property research result that has already " +
  "been fetched. Answer using ONLY the JSON data provided — never guess, estimate, or fill a " +
  "gap with general knowledge about typical homes. If the question asks about something that " +
  "isn't in the data, say so plainly: distinguish between a field that was researched but came " +
  "back null/not found, versus something that was never part of this research at all. Keep the " +
  "answer to 1-3 sentences.";

export type FollowUpErrorCode = "UPSTREAM_ERROR";

/** Thrown only for a genuine OpenAI failure (missing config, network error,
 * non-2xx response) — never for "the data doesn't have that," which is a
 * normal, honest answer the model itself produces. */
export class FollowUpError extends Error {
  constructor(
    public readonly code: FollowUpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FollowUpError";
  }
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new FollowUpError("UPSTREAM_ERROR", "OPENAI_API_KEY is not configured.");
  }
  cachedClient ??= new OpenAI({ apiKey });
  return cachedClient;
}

/**
 * Answers a conversational follow-up about an address already researched
 * this session, grounded only in that result's `fields` (PRD.md §4: "what's
 * the lot size" — a field never researched at all — should get an honest
 * "wasn't part of this research," not a guess). No re-fetching, no calling
 * RentCast/Parallel.ai/Overpass again — this is read-only over data the
 * caller already has.
 */
export async function answerFollowUp(question: string, result: ResearchResult): Promise<string> {
  const client = getClient();

  const context = JSON.stringify({
    address: result.geocode.matchedAddress,
    fields: result.fields,
  });

  let responseText: string;
  try {
    const response = await client.responses.create({
      model: FOLLOWUP_MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Property data:\n${context}\n\nQuestion: ${question}` },
      ],
    });
    responseText = response.output_text;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error.";
    throw new FollowUpError("UPSTREAM_ERROR", `OpenAI follow-up answering failed: ${detail}`);
  }

  return responseText.trim();
}
