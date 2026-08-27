import type { CSSProperties } from "react";
import { FIELD_LABELS, FIELD_PENDING_COPY, formatFieldValue } from "@/lib/formatFieldValue";
import type { LiveField } from "./liveField";

interface FieldRowProps {
  entry: LiveField;
  /** Staggers the reveal animation — see ResultCard. */
  index: number;
}

/** One row of the dossier's field list. While `entry.status === "pending"`
 * this renders an active-investigation state (Ticket 9) instead of the
 * value — never a guess in between, just a signal that real work is
 * happening. Once resolved, shows the same honest source/confidence
 * citation as before (PRD.md §8: every populated field is attributed,
 * every unpopulated one says so explicitly). */
export function FieldRow({ entry, index }: FieldRowProps) {
  const style = { "--reveal-index": index } as CSSProperties;
  const label = FIELD_LABELS[entry.field];

  if (entry.status === "pending") {
    return (
      <div className="field-row" data-pending="true" style={style}>
        <dt className="field-row__label">{label}</dt>
        <dd className="field-row__value-group">
          <span className="field-row__seal" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="field-row__pending-copy">{FIELD_PENDING_COPY[entry.field]}</span>
        </dd>
      </div>
    );
  }

  const field = entry.result;
  const confidenceKey = field.confidence ?? "none";

  return (
    <div className="field-row" data-found={field.value !== null} style={style}>
      <dt className="field-row__label">{label}</dt>
      <dd className="field-row__value-group">
        <span className="field-row__value">{formatFieldValue(field)}</span>
        {field.source && (
          <span className={`field-row__source field-row__source--${confidenceKey}`}>
            <span className="field-row__confidence-dot" aria-hidden="true" />
            {field.source}
          </span>
        )}
        {field.note && <span className="field-row__note">{field.note}</span>}
      </dd>
    </div>
  );
}
