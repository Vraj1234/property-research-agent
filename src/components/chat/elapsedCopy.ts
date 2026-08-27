/**
 * Reassurance copy for the case file's progress line while streaming — a
 * request can genuinely take up to several minutes (deep research mode), so
 * the microcopy has to change over time or a long wait reads as broken
 * rather than working (see decisions.md, Ticket 9). Bucketed on elapsed
 * time rather than which fields have resolved, since fields can legitimately
 * resolve out of order.
 */
export function elapsedResearchCopy(elapsedMs: number, deepResearch: boolean): string {
  if (elapsedMs < 15_000) return "Pulling records…";
  if (elapsedMs < 60_000) return "Cross-checking public listings…";
  if (deepResearch) {
    return "Deep research is on — mortgagee/owner lookups can take a few minutes.";
  }
  return "This one's taking some digging — some sources take longer to confirm.";
}
