import type { Confidence } from "./types";

const PARALLEL_RUNS_URL = "https://api.parallel.ai/v1/tasks/runs";

/**
 * Observed live (2026-08-26): `base` tier latency varies a lot by question
 * difficulty — HVAC finished in ~13s, but mortgagee (the hardest lookup)
 * exceeded even a 120s timeout on one address. Rather than keep chasing an
 * empirical ceiling, 90s is a deliberate, bounded default: a field that
 * can't resolve on `base` within that window is an honest "couldn't
 * determine this quickly" outcome (surfaced as a normal not-found note),
 * not a bug — that's exactly the gap the opt-in `deepResearch`/`core` path
 * exists to cover (see decisions.md), not something the default path should
 * silently wait minutes for. `core` itself took ~3.5 minutes for the same
 * mortgagee lookup, hence its much longer allowance.
 */
const BASE_TIER_TIMEOUT_MS = 90_000;
const CORE_TIER_TIMEOUT_MS = 5 * 60_000;

export type ParallelProcessor = "lite" | "base" | "core";

export type ParallelErrorCode = "UPSTREAM_ERROR";

/** Thrown for genuine Parallel.ai failures — missing config, network error,
 * non-2xx response, unparsable body, or a run that didn't finish within its
 * timeout. A field Parallel simply couldn't research is NOT this — callers
 * express that through the task's own output/schema, not an exception. */
export class ParallelError extends Error {
  constructor(
    public readonly code: ParallelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ParallelError";
  }
}

export interface ParallelJsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
}

interface CreateRunResponse {
  run_id: string;
}

interface FieldBasis {
  field: string;
  confidence: Confidence;
}

interface ResultResponse {
  run: { status: string };
  output: {
    content: Record<string, unknown>;
    basis: FieldBasis[];
  };
}

export interface ParallelTaskOutcome {
  content: Record<string, unknown>;
  /** Per-property-key confidence, straight from Parallel's own research basis. */
  confidenceByField: Record<string, Confidence>;
}

function timeoutForProcessor(processor: ParallelProcessor): number {
  return processor === "core" ? CORE_TIER_TIMEOUT_MS : BASE_TIER_TIMEOUT_MS;
}

/**
 * Runs one Parallel.ai Task API research task to completion and returns its
 * structured output plus a per-field confidence rating (PRD.md §5/§6 — the
 * fallback layer for any field RentCast leaves null, and the bed/bath/sqft
 * portal cross-check). Confirmed live: create returns HTTP 202 with a
 * `run_id`; `.../result` blocks server-side until the run completes, so no
 * manual polling loop is needed — only a client-side timeout as a backstop.
 */
export async function runParallelTask(
  input: string,
  outputSchema: ParallelJsonSchema,
  processor: ParallelProcessor,
): Promise<ParallelTaskOutcome> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    throw new ParallelError("UPSTREAM_ERROR", "PARALLEL_API_KEY is not configured.");
  }

  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };

  let createResponse: Response;
  try {
    createResponse = await fetch(PARALLEL_RUNS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input,
        processor,
        task_spec: { output_schema: { type: "json", json_schema: outputSchema } },
      }),
    });
  } catch {
    throw new ParallelError("UPSTREAM_ERROR", "Could not reach the Parallel.ai API.");
  }

  if (!createResponse.ok) {
    throw new ParallelError(
      "UPSTREAM_ERROR",
      `Parallel.ai returned HTTP ${createResponse.status} creating a task run.`,
    );
  }

  let created: CreateRunResponse;
  try {
    created = (await createResponse.json()) as CreateRunResponse;
  } catch {
    throw new ParallelError(
      "UPSTREAM_ERROR",
      "Parallel.ai returned a response that could not be parsed as JSON.",
    );
  }

  let resultResponse: Response;
  try {
    resultResponse = await fetch(`${PARALLEL_RUNS_URL}/${created.run_id}/result`, {
      headers,
      signal: AbortSignal.timeout(timeoutForProcessor(processor)),
    });
  } catch {
    throw new ParallelError("UPSTREAM_ERROR", "Parallel.ai task did not complete in time.");
  }

  if (!resultResponse.ok) {
    throw new ParallelError(
      "UPSTREAM_ERROR",
      `Parallel.ai returned HTTP ${resultResponse.status} fetching a task result.`,
    );
  }

  let result: ResultResponse;
  try {
    result = (await resultResponse.json()) as ResultResponse;
  } catch {
    throw new ParallelError(
      "UPSTREAM_ERROR",
      "Parallel.ai returned a result that could not be parsed as JSON.",
    );
  }

  const confidenceByField: Record<string, Confidence> = {};
  for (const basis of result.output.basis ?? []) {
    confidenceByField[basis.field] = basis.confidence;
  }

  return { content: result.output.content ?? {}, confidenceByField };
}
