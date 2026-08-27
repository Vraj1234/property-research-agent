"use client";

import { useEffect, useState } from "react";
import { elapsedResearchCopy } from "./elapsedCopy";
import { FieldRow } from "./FieldRow";
import type { LiveField } from "./liveField";

interface ResultCardProps {
  address: string;
  fields: LiveField[];
  notices: string[];
  /** True while the SSE stream backing this card is still open (Ticket 9).
   * Once it flips to false, `fields` holds the same all-resolved shape
   * either way — no separate "final" rendering path. */
  isStreaming: boolean;
  /** `Date.now()` when this card started researching — drives the
   * elapsed-time-aware reassurance copy while streaming. */
  startedAt: number;
  deepResearch: boolean;
}

/**
 * The agent's response — a structured card rendered directly from the
 * pipeline's JSON. No LLM writes this card (PRD.md §6): every value, label,
 * source, and confidence here comes straight from field results streamed
 * off `/api/research`. Renders identically whether a row just resolved a
 * second ago or the whole case closed minutes back (Ticket 9).
 */
export function ResultCard({ address, fields, notices, isStreaming, startedAt, deepResearch }: ResultCardProps) {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const total = fields.length;
  const resolvedCount = fields.filter((f) => f.status === "resolved").length;
  const foundCount = fields.filter((f) => f.status === "resolved" && f.result.value !== null).length;
  const progressPercent = total === 0 ? 0 : Math.round((resolvedCount / total) * 100);

  return (
    <article className="result-card" data-streaming={isStreaming}>
      <span className="result-card__stamp" aria-hidden="true">
        {isStreaming ? "Investigating" : "Filed"}
      </span>

      <header className="result-card__header">
        <p className="result-card__eyebrow">Case file</p>
        <h2 className="result-card__address">{address || "Locating address…"}</h2>

        {isStreaming ? (
          <div className="result-card__progress" role="status" aria-live="polite">
            <p className="result-card__tally">
              {resolvedCount} of {total} leads confirmed
            </p>
            <div className="result-card__progress-track">
              <div className="result-card__progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="result-card__elapsed">{elapsedResearchCopy(now - startedAt, deepResearch)}</p>
          </div>
        ) : (
          <p className="result-card__tally">
            {foundCount} of {total} fields found
          </p>
        )}
      </header>

      {notices.length > 0 && (
        <div className="result-card__notices">
          {notices.map((notice) => (
            <p key={notice} className="result-card__notice">
              {notice}
            </p>
          ))}
        </div>
      )}

      <dl className="result-card__fields">
        {fields.map((entry, index) => (
          <FieldRow key={entry.field} entry={entry} index={index} />
        ))}
      </dl>
    </article>
  );
}
