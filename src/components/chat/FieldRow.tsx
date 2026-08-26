import type { CSSProperties } from "react";
import { FIELD_LABELS, formatFieldValue } from "@/lib/formatFieldValue";
import type { FieldResult } from "@/lib/types";

interface FieldRowProps {
  field: FieldResult;
  /** Staggers the reveal animation — see ResultCard. */
  index: number;
}

/** One row of the dossier's field list — label, value, and an honest
 * source/confidence citation (PRD.md §8: every populated field is
 * attributed, every unpopulated one says so explicitly). */
export function FieldRow({ field, index }: FieldRowProps) {
  const confidenceKey = field.confidence ?? "none";

  return (
    <div
      className="field-row"
      data-found={field.value !== null}
      style={{ "--reveal-index": index } as CSSProperties}
    >
      <dt className="field-row__label">{FIELD_LABELS[field.field]}</dt>
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
