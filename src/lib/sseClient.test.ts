import { describe, expect, it } from "vitest";
import { readSseEvents } from "./sseClient";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const events: string[] = [];
  for await (const event of readSseEvents(body)) events.push(event);
  return events;
}

describe("readSseEvents", () => {
  it("yields each event's data payload when one chunk holds several complete events", async () => {
    const events = await collect(streamOf(['data: {"a":1}\n\ndata: {"a":2}\n\n']));

    expect(events).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("reassembles a single event split across multiple chunks", async () => {
    const events = await collect(streamOf(['data: {"a":', '1}\n', "\n"]));

    expect(events).toEqual(['{"a":1}']);
  });

  it("ignores a trailing partial event with no closing blank line", async () => {
    const events = await collect(streamOf(['data: {"a":1}\n\ndata: {"a":2}']));

    expect(events).toEqual(['{"a":1}']);
  });

  it("yields nothing for an empty stream", async () => {
    const events = await collect(streamOf([]));

    expect(events).toEqual([]);
  });
});
