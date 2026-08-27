"use client";

import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/photon";
import type { AutocompleteResponse } from "@/lib/types";

/** Matches the server's own floor (route.ts) — no point debouncing a
 * request that would just come back empty anyway. */
const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;

/**
 * Debounced US address suggestions for the chat input as the user types
 * (Ticket 10) — a UI convenience only, never part of the research pipeline
 * itself. Silently yields no suggestions on a short query or any upstream
 * failure (the API route already degrades the same way) — autocomplete not
 * working should never block typing or submitting a full address manually.
 * A request-id guard discards a stale response that resolves after a newer
 * keystroke already superseded it.
 */
export function useAddressAutocomplete(query: string, enabled: boolean): AddressSuggestion[] {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const latestRequestId = useRef(0);
  const trimmed = query.trim();
  const shouldFetch = enabled && trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    // Nothing to fetch — the hook's return value below already derives an
    // empty list for this case, so there's no state to reset here.
    if (!shouldFetch) return;

    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;

    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(trimmed)}`);
        const body = (await response.json()) as AutocompleteResponse;
        if (latestRequestId.current === requestId) setSuggestions(body.suggestions);
      } catch {
        if (latestRequestId.current === requestId) setSuggestions([]);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [shouldFetch, trimmed]);

  // Derived, not effect-driven: a too-short/disabled query always reads as
  // no suggestions immediately, even if a stale fetch from a longer query
  // is still in flight.
  return shouldFetch ? suggestions : [];
}
