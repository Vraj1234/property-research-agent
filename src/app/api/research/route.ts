import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AddressParseError, parseAddressFromMessage } from "@/lib/addressParser";
import { FollowUpError, answerFollowUp } from "@/lib/followUp";
import { geocodeAddress, GeocodingError } from "@/lib/geocode";
import { researchFields } from "@/lib/orchestrator";
import type {
  ApiErrorBody,
  ChatResponse,
  FieldResult,
  GeocodeResult,
  ResearchResult,
  ResearchStreamEvent,
} from "@/lib/types";

/** deepResearch's `core` Parallel tier has been observed taking ~3.5 min for
 * a single mortgagee lookup (decisions.md 2026-08-26) — the default Vercel
 * function timeout is nowhere near enough for that. Streaming (below) fixes
 * the *user-facing* silent wait, but the serverless function itself still
 * has to stay alive the whole time. */
export const maxDuration = 300;

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

function sseLine(event: ResearchStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Streams each field to the client the moment it resolves, instead of
 * making the browser wait silently for all 9 (Ticket 9 — a request can take
 * anywhere from 15s to several minutes with deep research on). Geocoding
 * already succeeded by the time this is called, so every failure from here
 * on is one the pipeline already treats as an honest "not found" field
 * rather than a thrown error (PRD.md §8) — except a genuinely unexpected
 * bug, which gets reported as an "error" event rather than an HTTP status,
 * since the response has already committed to 200 by the time streaming
 * starts.
 */
function streamResearch(address: string, geocode: GeocodeResult, deepResearch: boolean): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client can disconnect (tab closed, fetch aborted, a client-side
      // timeout) at any point while `researchFields` is still running in
      // the background — `webResearchFallback`/`distanceFields` keep
      // resolving and calling `onFieldResolved` regardless. Every
      // `enqueue`/`close` after the browser has gone away throws
      // `TypeError [ERR_INVALID_STATE]: Controller is already closed` —
      // live-reproduced by deliberately truncating a request mid-stream.
      // `closed` plus this try/catch makes every send after that a safe
      // no-op instead of an unhandled exception.
      let closed = false;
      const send = (event: ResearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseLine(event));
        } catch {
          closed = true;
        }
      };

      send({ type: "geocode", geocode });

      try {
        const { fields, notices } = await researchFields(
          address,
          geocode,
          { deepResearch },
          (field: FieldResult) => send({ type: "field", field }),
        );
        const result: ResearchResult = {
          input: { address, deepResearch },
          geocode,
          fields,
          notices,
        };
        send({ type: "done", result });
      } catch (err) {
        console.error("[/api/research] Unexpected error while streaming field research:", err);
        send({
          type: "error",
          code: "UPSTREAM_ERROR",
          message: "Unexpected server error while researching this address.",
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // The client disconnected in the narrow window between the
            // last send() and this close() — nothing left to do.
          }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
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

  // Geocoding happens here, still outside the stream, so a miss or an
  // upstream outage can still surface as a normal HTTP status (unchanged
  // from Ticket 2) rather than an in-stream error event.
  let geocode: GeocodeResult;
  try {
    geocode = await geocodeAddress(address);
  } catch (err) {
    if (err instanceof GeocodingError) {
      const status = err.code === "NO_MATCH" ? 422 : 502;
      return errorResponse(status, err.code, err.message);
    }
    return errorResponse(500, "UPSTREAM_ERROR", "Unexpected server error.");
  }

  return streamResearch(address, geocode, parsed.data.deepResearch ?? false);
}
