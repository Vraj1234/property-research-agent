import { geocodeAddress } from "./geocode";
import type { ResearchResult } from "./types";

/**
 * Deterministic pipeline entry point — no LLM in this loop (PRD.md §6). Tickets
 * 3-5 will extend this to call RentCast, Parallel.ai, HIFLD, and Overpass and
 * populate `fields`. For now it only geocodes, giving later tickets a fixed
 * shape to slot providers into.
 */
export async function researchAddress(address: string): Promise<ResearchResult> {
  const geocode = await geocodeAddress(address);

  return {
    input: { address },
    geocode,
    fields: [],
  };
}
