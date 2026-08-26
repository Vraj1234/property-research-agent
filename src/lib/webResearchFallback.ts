import { runParallelTask, ParallelError, type ParallelProcessor, type ParallelTaskOutcome } from "./parallel";
import type { BedBathCount, Confidence, FieldResult, PropertyFieldKey } from "./types";

/** ~2 years, per PRD.md §5's recency trigger for the bed/bath/sqft cross-check. */
const RECENCY_THRESHOLD_DAYS = 730;

/**
 * Live-tested 2026-08-26: asked to leave a *string* field blank when unknown,
 * Parallel.ai instead wrote out a prose refusal ("Unknown—not identified in
 * the available public records.") rather than omitting the key or returning
 * an empty string. An explicit machine-readable sentinel is far more
 * reliable to parse than trusting the model to abstain gracefully — this is
 * instructed in every string/array prompt below and checked for on the way
 * back in. Not exhaustively verified beyond that one live case; worth a
 * spot-check in Ticket 8 QA.
 */
const NOT_FOUND_SENTINEL = "NOT_FOUND";

function isRecentSale(lastSaleDate: string | null): boolean {
  if (!lastSaleDate) return false;
  const saleTime = Date.parse(lastSaleDate);
  if (Number.isNaN(saleTime)) return false;
  const ageDays = (Date.now() - saleTime) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= RECENCY_THRESHOLD_DAYS;
}

/** True for values that mean "Parallel.ai didn't find this" — the explicit
 * sentinel (string fields), an empty array, an array whose entries are all
 * just the sentinel wrapped to satisfy the schema's array shape (live-tested
 * 2026-08-26: asked for an array of strings, Parallel.ai returned
 * `["NOT_FOUND"]` rather than `[]` or omitting the key — a subtler dodge of
 * the same "explain instead of abstain" behavior noted above), or an
 * absent/null key (numeric fields, which can't legally hold the sentinel and
 * are instructed to be omitted instead — see the prompts below). */
function isNotFound(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string") return raw.trim() === "" || raw.trim() === NOT_FOUND_SENTINEL;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return true;
    return raw.every((item) => typeof item === "string" && item.trim() === NOT_FOUND_SENTINEL);
  }
  return false;
}

function findField<T>(fields: FieldResult[], key: PropertyFieldKey): FieldResult<T> {
  const field = fields.find((f) => f.field === key);
  if (!field) {
    throw new Error(`webResearchFallback: expected a "${key}" field in baseFields, found none.`);
  }
  return field as FieldResult<T>;
}

function withFallbackNote<T>(field: FieldResult<T>, extra: string): FieldResult<T> {
  return { ...field, note: field.note ? `${field.note} ${extra}` : extra };
}

interface FillOptions<T> {
  address: string;
  field: FieldResult<T>;
  question: string;
  propertyKey: string;
  propertySchema: Record<string, unknown>;
  processor: ParallelProcessor;
}

/**
 * Fills one field via Parallel.ai if (and only if) RentCast left it null.
 * Never overwrites a value RentCast already provided — this is a gap-filler,
 * not a second opinion (that's `resolveBedBathSqft`'s job, the one place
 * PRD.md §5 calls for an actual cross-check).
 */
async function fillIfNull<T>(options: FillOptions<T>): Promise<FieldResult<T>> {
  const { address, field, question, propertyKey, propertySchema, processor } = options;
  if (field.value !== null) return field;

  let outcome: ParallelTaskOutcome;
  try {
    outcome = await runParallelTask(
      `${question} Address: ${address}.`,
      {
        type: "object",
        properties: { [propertyKey]: propertySchema },
        required: [],
        additionalProperties: false,
      },
      processor,
    );
  } catch (err) {
    console.error(`[webResearchFallback] Parallel.ai null-fill failed for "${field.field}":`, err);
    return withFallbackNote(field, "Parallel.ai fallback also failed to run.");
  }

  const raw = outcome.content[propertyKey];
  if (isNotFound(raw)) {
    return withFallbackNote(field, "Parallel.ai fallback also found nothing.");
  }

  return {
    field: field.field,
    value: raw as T,
    source: "Parallel.ai",
    confidence: outcome.confidenceByField[propertyKey] ?? "medium",
  };
}

function fillOwnerName(
  address: string,
  field: FieldResult<string[]>,
): Promise<FieldResult<string[]>> {
  return fillIfNull({
    address,
    field,
    question:
      `Research the current owner-of-record name(s) for this property. If you cannot determine ` +
      `this with reasonable confidence, respond with exactly the string "${NOT_FOUND_SENTINEL}".`,
    propertyKey: "ownerNames",
    propertySchema: {
      type: "array",
      items: { type: "string" },
      description: `Owner name(s) on record, or the single string "${NOT_FOUND_SENTINEL}" if unknown.`,
    },
    processor: "base",
  });
}

function fillMortgagee(address: string, processor: ParallelProcessor): Promise<FieldResult<string>> {
  const emptyField: FieldResult<string> = {
    field: "mortgagee",
    value: null,
    source: null,
    confidence: null,
    note: "RentCast does not report mortgage/lender data.",
  };
  return fillIfNull({
    address,
    field: emptyField,
    question:
      `Research public records and news for the current mortgage lender/mortgagee on this ` +
      `property, if any. If you cannot determine this with reasonable confidence, respond with ` +
      `exactly the string "${NOT_FOUND_SENTINEL}".`,
    propertyKey: "mortgagee",
    propertySchema: {
      type: "string",
      description: `The mortgage lender/mortgagee name, or exactly "${NOT_FOUND_SENTINEL}" if unknown.`,
    },
    processor,
  });
}

function fillHvacType(address: string, field: FieldResult<string>): Promise<FieldResult<string>> {
  return fillIfNull({
    address,
    field,
    question:
      `Research the heating and cooling (HVAC) system type installed at this property. If you ` +
      `cannot determine this with reasonable confidence, respond with exactly the string "${NOT_FOUND_SENTINEL}".`,
    propertyKey: "hvacType",
    propertySchema: {
      type: "string",
      description: `Heating/cooling system type, or exactly "${NOT_FOUND_SENTINEL}" if unknown.`,
    },
    processor: "base",
  });
}

function fillYearBuilt(address: string, field: FieldResult<number>): Promise<FieldResult<number>> {
  return fillIfNull({
    address,
    field,
    question:
      "Research the year this property was originally built. Omit the yearBuilt field entirely " +
      "from your output if you cannot determine an actual year — do not guess or estimate.",
    propertyKey: "yearBuilt",
    propertySchema: { type: "integer", description: "Year the property was built. Omit entirely if unknown." },
    processor: "base",
  });
}

function fillPropertyTaxAmount(
  address: string,
  field: FieldResult<number>,
): Promise<FieldResult<number>> {
  return fillIfNull({
    address,
    field,
    question:
      "Research the most recent annual property tax amount for this property. Omit the " +
      "propertyTaxAmount field entirely from your output if you cannot determine an actual " +
      "dollar figure — do not guess or estimate.",
    propertyKey: "propertyTaxAmount",
    propertySchema: {
      type: "number",
      description: "Most recent annual property tax total in USD. Omit entirely if unknown.",
    },
    processor: "base",
  });
}

interface BedBathSqftContent {
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
}

async function runBedBathSqftTask(address: string): Promise<ParallelTaskOutcome | null> {
  try {
    return await runParallelTask(
      `Research the current bedroom count, bathroom count, and total finished square footage ` +
        `for the property at ${address}, checking real estate listing sources for figures that ` +
        `may be more current than county assessor records. Omit any of the three fields entirely ` +
        `from your output that you cannot determine — do not guess or estimate.`,
      {
        type: "object",
        properties: {
          bedrooms: { type: "number", description: "Number of bedrooms. Omit entirely if unknown." },
          bathrooms: { type: "number", description: "Number of bathrooms. Omit entirely if unknown." },
          squareFootage: {
            type: "number",
            description: "Total finished square footage. Omit entirely if unknown.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      "base",
    );
  } catch (err) {
    console.error("[webResearchFallback] Parallel.ai bed/bath/sqft task failed:", err);
    return null;
  }
}

function extractNumber(content: BedBathSqftContent, key: keyof BedBathSqftContent): number | null {
  const raw = content[key];
  return isNotFound(raw) ? null : (raw as number);
}

function mergeBedBath(
  field: FieldResult<BedBathCount>,
  outcome: ParallelTaskOutcome | null,
): FieldResult<BedBathCount> {
  if (outcome === null) {
    return field.value === null
      ? withFallbackNote(field, "Parallel.ai fallback also found nothing.")
      : field; // A cross-check attempt that failed doesn't get to erase a real RentCast value.
  }

  const content = outcome.content as BedBathSqftContent;
  const bedrooms = extractNumber(content, "bedrooms");
  const bathrooms = extractNumber(content, "bathrooms");
  const confidence: Confidence =
    outcome.confidenceByField.bedrooms ?? outcome.confidenceByField.bathrooms ?? "medium";

  if (field.value === null) {
    if (bedrooms === null && bathrooms === null) {
      return withFallbackNote(field, "Parallel.ai fallback also found nothing.");
    }
    return { field: "bedBathCount", value: { bedrooms, bathrooms }, source: "Parallel.ai", confidence };
  }

  const current = field.value;
  const disagrees =
    (bedrooms !== null && bedrooms !== current.bedrooms) ||
    (bathrooms !== null && bathrooms !== current.bathrooms);
  if (!disagrees) return field;

  return {
    field: "bedBathCount",
    value: { bedrooms: bedrooms ?? current.bedrooms, bathrooms: bathrooms ?? current.bathrooms },
    source: "Parallel.ai (portal cross-check)",
    confidence,
    note:
      `RentCast/assessor records showed ${current.bedrooms ?? "unknown"} bed / ` +
      `${current.bathrooms ?? "unknown"} bath; a sale or listing within the last 2 years ` +
      "suggested this may be outdated.",
  };
}

function mergeSquareFootage(
  field: FieldResult<number>,
  outcome: ParallelTaskOutcome | null,
): FieldResult<number> {
  if (outcome === null) {
    return field.value === null
      ? withFallbackNote(field, "Parallel.ai fallback also found nothing.")
      : field;
  }

  const content = outcome.content as BedBathSqftContent;
  const squareFootage = extractNumber(content, "squareFootage");
  const confidence: Confidence = outcome.confidenceByField.squareFootage ?? "medium";

  if (field.value === null) {
    return squareFootage === null
      ? withFallbackNote(field, "Parallel.ai fallback also found nothing.")
      : { field: "squareFootage", value: squareFootage, source: "Parallel.ai", confidence };
  }

  if (squareFootage === null || squareFootage === field.value) return field;

  return {
    field: "squareFootage",
    value: squareFootage,
    source: "Parallel.ai (portal cross-check)",
    confidence,
    note:
      `RentCast/assessor records showed ${field.value} sqft; a sale or listing within the last ` +
      "2 years suggested this may be outdated.",
  };
}

/** True when this field needs a Parallel.ai attempt: it's null (null-fill),
 * or it has a value but a recent sale/listing means it's worth verifying. */
function needsBedBathSqftAction(field: FieldResult<unknown>, recencyTriggered: boolean): boolean {
  return field.value === null || recencyTriggered;
}

async function resolveBedBathSqft(
  address: string,
  bedBathField: FieldResult<BedBathCount>,
  sqftField: FieldResult<number>,
  lastSaleDate: string | null,
): Promise<{ bedBathField: FieldResult<BedBathCount>; sqftField: FieldResult<number> }> {
  const recencyTriggered = isRecentSale(lastSaleDate);
  const bedBathNeedsAction = needsBedBathSqftAction(bedBathField, recencyTriggered);
  const sqftNeedsAction = needsBedBathSqftAction(sqftField, recencyTriggered);

  if (!bedBathNeedsAction && !sqftNeedsAction) {
    return { bedBathField, sqftField };
  }

  // One combined call serves both null-fill and cross-check for whichever
  // of the two fields actually needs it (PRD.md §5: one bed/bath/sqft
  // trigger, not three separate provider calls).
  const outcome = await runBedBathSqftTask(address);

  return {
    bedBathField: bedBathNeedsAction ? mergeBedBath(bedBathField, outcome) : bedBathField,
    sqftField: sqftNeedsAction ? mergeSquareFootage(sqftField, outcome) : sqftField,
  };
}

export interface WebResearchFallbackOptions {
  /** When true, mortgagee/owner (the hardest lookups) use Parallel's `core`
   * tier instead of `base` — much higher latency (~3.5 min observed vs.
   * ~15-40s), opt-in only. See decisions.md 2026-08-26. */
  deepResearch?: boolean;
}

/**
 * The Ticket 4 fallback/enrichment layer: one reusable pass over every
 * RentCast-fed field (PRD.md §5/§6) that fills whatever RentCast left null
 * via Parallel.ai, cross-checks bed/bath/sqft when a recent sale/listing
 * makes assessor data suspect, and appends mortgagee — a field RentCast
 * structurally never supplies, sourced here for the first time. Runs every
 * Parallel.ai call in parallel, not as a serial waterfall (PRD.md §8).
 */
export async function webResearchFallback(
  address: string,
  baseFields: FieldResult[],
  lastSaleDate: string | null,
  options: WebResearchFallbackOptions = {},
): Promise<FieldResult[]> {
  const mortgageeProcessor: ParallelProcessor = options.deepResearch ? "core" : "base";

  const bedBathField = findField<BedBathCount>(baseFields, "bedBathCount");
  const sqftField = findField<number>(baseFields, "squareFootage");
  const yearBuiltField = findField<number>(baseFields, "yearBuilt");
  const ownerField = findField<string[]>(baseFields, "ownerName");
  const hvacField = findField<string>(baseFields, "hvacType");
  const taxField = findField<number>(baseFields, "propertyTaxAmount");

  const [bedBathSqft, yearBuilt, ownerName, mortgagee, hvacType, propertyTaxAmount] = await Promise.all([
    resolveBedBathSqft(address, bedBathField, sqftField, lastSaleDate),
    fillYearBuilt(address, yearBuiltField),
    fillOwnerName(address, ownerField),
    fillMortgagee(address, mortgageeProcessor),
    fillHvacType(address, hvacField),
    fillPropertyTaxAmount(address, taxField),
  ]);

  return [
    bedBathSqft.bedBathField,
    bedBathSqft.sqftField,
    yearBuilt,
    ownerName,
    mortgagee,
    hvacType,
    propertyTaxAmount,
  ];
}

export { ParallelError };
