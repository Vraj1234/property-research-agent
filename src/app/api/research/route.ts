import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AddressParseError, parseAddressFromMessage } from "@/lib/addressParser";
import { FollowUpError, answerFollowUp } from "@/lib/followUp";
import { GeocodingError } from "@/lib/geocode";
import { researchAddress } from "@/lib/orchestrator";
import type { ApiErrorBody, ChatResponse, ResearchResult } from "@/lib/types";

const fieldResultSchema = z.object({
  field: z.string(),
  value: z.unknown(),
  source: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  note: z.string().optional(),
});

/** Loose on purpose — this is the client echoing back a result the server
 * itself produced, not user-authored data; `value`'s exact shape varies per
 * field key (BedBathCount vs. a plain number vs. NearbyDistance) and isn't
 * worth re-encoding here. */
const researchResultSchema = z.object({
  input: z.object({ address: z.string(), deepResearch: z.boolean() }),
  geocode: z.object({ latitude: z.number(), longitude: z.number(), matchedAddress: z.string() }),
  fields: z.array(fieldResultSchema),
  notices: z.array(z.string()),
});

const requestSchema = z.object({
  /** Free-text chat message — a bare address ("123 Main St, Springfield, IL")
   * works too, since OpenAI's extraction step (PRD.md §6 step 1) treats a
   * clean address as the trivial case of a message to parse. */
  message: z.string().trim().min(1, "message must not be empty"),
  /** Opt-in deep research for mortgagee/owner (Parallel `core` tier) — much
   * slower (~3.5 min observed vs. ~15-40s on `base`), see decisions.md
   * 2026-08-26. Defaults to false. */
  deepResearch: z.boolean().optional(),
  /** The most recent successful result in this chat thread, if any. When
   * `message` doesn't contain a new address, this is treated as a
   * follow-up question about it instead of a hard "no address found"
   * (Ticket 7 — PRD.md §4/§6). Sent by the client each time since there's
   * no server-side session/database (decisions.md 2026-08-25). */
  previousResult: researchResultSchema.optional(),
});

function errorResponse(
  status: number,
  code: ApiErrorBody["error"]["code"],
  message: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "INVALID_INPUT", "Request body must be valid JSON.");
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  let address: string | null;
  try {
    address = await parseAddressFromMessage(parsed.data.message);
  } catch (err) {
    const message = err instanceof AddressParseError ? err.message : "Unexpected address-parsing failure.";
    return errorResponse(502, "UPSTREAM_ERROR", message);
  }

  if (address === null) {
    if (parsed.data.previousResult) {
      try {
        // Zod validates the shape loosely (field: string, not the
        // PropertyFieldKey union — see researchResultSchema above); the
        // client only ever echoes back a result this server produced, so
        // the cast is safe in practice.
        const answer = await answerFollowUp(
          parsed.data.message,
          parsed.data.previousResult as ResearchResult,
        );
        return NextResponse.json<ChatResponse>({ type: "answer", answer }, { status: 200 });
      } catch (err) {
        const message = err instanceof FollowUpError ? err.message : "Unexpected follow-up failure.";
        return errorResponse(502, "UPSTREAM_ERROR", message);
      }
    }
    return errorResponse(
      422,
      "NO_ADDRESS_FOUND",
      "I couldn't find a US address in that message — try including the street, city, and state.",
    );
  }

  try {
    const result = await researchAddress(address, {
      deepResearch: parsed.data.deepResearch,
    });
    return NextResponse.json<ChatResponse>({ type: "research", result }, { status: 200 });
  } catch (err) {
    if (err instanceof GeocodingError) {
      const status = err.code === "NO_MATCH" ? 422 : 502;
      return errorResponse(status, err.code, err.message);
    }
    return errorResponse(500, "UPSTREAM_ERROR", "Unexpected server error.");
  }
}
