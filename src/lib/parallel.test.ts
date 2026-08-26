import { describe, expect, it, vi, afterEach } from "vitest";
import { runParallelTask, ParallelError } from "./parallel";

const SCHEMA = {
  type: "object" as const,
  properties: { hvacType: { type: "string" } },
  required: [],
  additionalProperties: false as const,
};

describe("runParallelTask", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates a run then fetches its blocking result, returning content and per-field confidence", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ run_id: "trun_abc", status: "queued" }), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: { status: "completed" },
            output: {
              content: { hvacType: "Forced Air heating, Central cooling" },
              basis: [{ field: "hvacType", confidence: "medium" }],
            },
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;

    const result = await runParallelTask("Research HVAC type. Address: 1 Main St.", SCHEMA, "base");

    expect(result).toEqual({
      content: { hvacType: "Forced Air heating, Central cooling" },
      confidenceByField: { hvacType: "medium" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.parallel.ai/v1/tasks/runs");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.parallel.ai/v1/tasks/runs/trun_abc/result");
  });

  it("throws ParallelError when PARALLEL_API_KEY is not configured", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "");

    await expect(runParallelTask("q", SCHEMA, "base")).rejects.toMatchObject({
      name: "ParallelError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws ParallelError when creating the run fails with a non-OK status", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));

    await expect(runParallelTask("q", SCHEMA, "base")).rejects.toMatchObject({
      name: "ParallelError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws ParallelError when the create request itself fails (network error)", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(runParallelTask("q", SCHEMA, "base")).rejects.toBeInstanceOf(ParallelError);
  });

  it("throws ParallelError when fetching the result fails with a non-OK status", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "trun_abc" }), { status: 202 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));

    await expect(runParallelTask("q", SCHEMA, "base")).rejects.toMatchObject({
      name: "ParallelError",
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws ParallelError when the result request itself fails (timeout/network error)", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "trun_abc" }), { status: 202 }))
      .mockRejectedValueOnce(new Error("aborted"));

    await expect(runParallelTask("q", SCHEMA, "base")).rejects.toBeInstanceOf(ParallelError);
  });

  it("defaults a field's confidence to absent when the result has no basis entry for it", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "trun_abc" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ run: { status: "completed" }, output: { content: { hvacType: "NOT_FOUND" }, basis: [] } }),
          { status: 200 },
        ),
      );

    const result = await runParallelTask("q", SCHEMA, "base");

    expect(result.confidenceByField).toEqual({});
    expect(result.content).toEqual({ hvacType: "NOT_FOUND" });
  });
});
