import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AddressParseError, parseAddressFromMessage } from "@/lib/addressParser";
import { GeocodingError } from "@/lib/geocode";
import { researchAddress } from "@/lib/orchestrator";
import type { ApiErrorBody } from "@/lib/types";

const requestSchema = z.object({
  /** Free-text chat message — a bare address ("123 Main St, Springfield, IL")
   * works too, since OpenAI's extraction step (PRD.md §6 step 1) treats a
   * clean address as the trivial case of a message to parse. */
  message: z.string().trim().min(1, "message must not be empty"),
  /** Opt-in deep research for mortgagee/owner (Parallel `core` tier) — much
   * slower (~3.5 min observed vs. ~15-40s on `base`), see decisions.md
   * 2026-08-26. Defaults to false. */
  deepResearch: z.boolean().optional(),
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

  let address: string;
  try {
    const extracted = await parseAddressFromMessage(parsed.data.message);
    if (extracted === null) {
      return errorResponse(
        422,
        "NO_ADDRESS_FOUND",
        "I couldn't find a US address in that message — try including the street, city, and state.",
      );
    }
    address = extracted;
  } catch (err) {
    const message = err instanceof AddressParseError ? err.message : "Unexpected address-parsing failure.";
    return errorResponse(502, "UPSTREAM_ERROR", message);
  }

  try {
    const result = await researchAddress(address, {
      deepResearch: parsed.data.deepResearch,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof GeocodingError) {
      const status = err.code === "NO_MATCH" ? 422 : 502;
      return errorResponse(status, err.code, err.message);
    }
    return errorResponse(500, "UPSTREAM_ERROR", "Unexpected server error.");
  }
}
