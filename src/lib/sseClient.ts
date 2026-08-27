/**
 * Minimal Server-Sent Events reader for `fetch`'s streaming body. Not using
 * the browser's built-in `EventSource` here since it only supports GET with
 * no custom body — `/api/research` is a POST (Ticket 9). Framework-agnostic
 * and independently testable from the React layer that consumes it.
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) yield dataLine.slice(5).trimStart();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
