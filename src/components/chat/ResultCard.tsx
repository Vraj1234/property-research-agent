import { FieldRow } from "./FieldRow";
import type { ResearchResult } from "@/lib/types";

interface ResultCardProps {
  result: ResearchResult;
}

/**
 * The agent's response — a structured card rendered directly from the
 * pipeline's JSON. No LLM writes this card (PRD.md §6): every value, label,
 * source, and confidence here comes straight from `ResearchResult`.
 */
export function ResultCard({ result }: ResultCardProps) {
  const foundCount = result.fields.filter((f) => f.value !== null).length;

  return (
    <article className="result-card">
      <span className="result-card__stamp" aria-hidden="true">
        Filed
      </span>

      <header className="result-card__header">
        <p className="result-card__eyebrow">Case file</p>
        <h2 className="result-card__address">{result.geocode.matchedAddress}</h2>
        <p className="result-card__tally">
          {foundCount} of {result.fields.length} fields found
        </p>
      </header>

      {result.notices.length > 0 && (
        <div className="result-card__notices">
          {result.notices.map((notice) => (
            <p key={notice} className="result-card__notice">
              {notice}
            </p>
          ))}
        </div>
      )}

      <dl className="result-card__fields">
        {result.fields.map((field, index) => (
          <FieldRow key={field.field} field={field} index={index} />
        ))}
      </dl>
    </article>
  );
}
