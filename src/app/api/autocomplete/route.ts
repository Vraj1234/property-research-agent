import { NextRequest, NextResponse } from "next/server";
import { getAddressSuggestions, PhotonError } from "@/lib/photon";
import type { AutocompleteResponse } from "@/lib/types";

/** Below this length Photon's results are too broad to be useful and it's
 * not worth spending a request on every keystroke. */
const MIN_QUERY_LENGTH = 3;

/**
 * GET /api/autocomplete?q=<partial address> — see AutocompleteResponse in
 * types.ts for why this always returns 200 with `suggestions: []` on any
 * failure rather than an error response.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json<AutocompleteResponse>({ suggestions: [] });
  }

  try {
    const suggestions = await getAddressSuggestions(query);
    return NextResponse.json<AutocompleteResponse>({ suggestions });
  } catch (err) {
    const message = err instanceof PhotonError ? err.message : "Unexpected autocomplete failure.";
    console.error("[/api/autocomplete] Suggestion lookup failed:", message);
    return NextResponse.json<AutocompleteResponse>({ suggestions: [] });
  }
}
