import type { FieldResult, PropertyFieldKey } from "@/lib/types";

/** Display order for the case file's 9 rows — matches the order the
 * pipeline itself assembles fields in (orchestrator.ts: RentCast fields,
 * mortgagee, then the two distance fields). Fixed here because Ticket 9
 * needs to render every row immediately, before any field has actually
 * resolved and could otherwise supply this ordering itself. */
export const ALL_FIELD_KEYS: PropertyFieldKey[] = [
  "bedBathCount",
  "squareFootage",
  "yearBuilt",
  "ownerName",
  "mortgagee",
  "hvacType",
  "propertyTaxAmount",
  "nearestFireStationDistance",
  "nearestFireHydrantDistance",
];

/** One row's live state in the case file: still being investigated, or
 * settled with a final (possibly null/"not found") result. There is
 * deliberately no "provisional" state in between — a field is only ever
 * shown once its actual final value is known (PRD.md §8: never a guess). */
export type LiveField =
  | { field: PropertyFieldKey; status: "pending"; result: null }
  | { field: PropertyFieldKey; status: "resolved"; result: FieldResult };

/** The starting state of a new case file — every field pending, before the
 * stream has reported anything yet. */
export function createPendingFields(): LiveField[] {
  return ALL_FIELD_KEYS.map((field) => ({ field, status: "pending", result: null }));
}

/** Immutable update: returns a new array with the row matching `field.field`
 * marked resolved, everything else untouched (coding-style.md: never
 * mutate). A field key not already present in `fields` is left as-is rather
 * than silently dropped — defensive against a future field the UI doesn't
 * know how to seed yet. */
export function applyFieldEvent(fields: LiveField[], field: FieldResult): LiveField[] {
  return fields.map((entry) =>
    entry.field === field.field ? { field: entry.field, status: "resolved", result: field } : entry,
  );
}

/** Converts a finished pipeline's flat `FieldResult[]` into the same
 * `LiveField[]` shape used while streaming, so the case file can render the
 * "done" event through the exact same component with no branching. Any of
 * the 9 canonical fields the pipeline didn't return at all (shouldn't
 * happen, but PRD.md §8 says never hide a gap silently) stays pending
 * rather than vanishing. */
export function resolvedFields(fields: FieldResult[]): LiveField[] {
  return ALL_FIELD_KEYS.reduce((acc, key) => {
    const found = fields.find((f) => f.field === key) ?? {
      field: key,
      value: null,
      source: null,
      confidence: null,
      note: "This field wasn't returned by the research pipeline.",
    };
    return applyFieldEvent(acc, found);
  }, createPendingFields());
}
