import assert from "node:assert/strict";
import { test } from "node:test";
import { readNdjson } from "../lib/api";

/** A response body that delivers the text in arbitrary chunks. */
function stream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events: unknown[] = [];
  for await (const event of readNdjson(body)) events.push(event);
  return events;
}

test("events split across network chunks are reassembled in order", async () => {
  const lines = [
    { type: "stage", stage: "retrieval" },
    { type: "token", delta: "Four long flashes and " },
    { type: "token", delta: "four short mean [1]." },
    { type: "done", status: "answered" },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
  const events = await collect(
    stream([lines.slice(0, 17), lines.slice(17, 60), lines.slice(60), "\n"]),
  );
  assert.equal(events.length, 4);
  assert.deepEqual(events[2], {
    type: "token",
    delta: "four short mean [1].",
  });
});

test("multi-byte characters split between chunks survive", async () => {
  const bytes = new TextEncoder().encode('{"delta":"naïve — ✓"}\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 13));
      controller.enqueue(bytes.slice(13));
      controller.close();
    },
  });
  assert.deepEqual(await collect(body), [{ delta: "naïve — ✓" }]);
});

test("a final line without a newline and blank lines are handled", async () => {
  assert.deepEqual(await collect(stream(['{"a":1}\n\n', '{"b":2}'])), [
    { a: 1 },
    { b: 2 },
  ]);
});
