import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GeocodingError } from "@/lib/geocode";
import { researchAddress } from "@/lib/orchestrator";
import type { ApiErrorBody } from "@/lib/types";

const requestSchema = z.object({
  address: z.string().trim().min(3, "address must be a non-empty string"),
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

  try {
    const result = await researchAddress(parsed.data.address, {
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
