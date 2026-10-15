import assert from "node:assert/strict";
import { test } from "node:test";
import { API_VERSION_HEADER } from "../lib/contract";
import { applyEvent, newTurn, runTurn } from "../lib/turns";
import type { AskEvent, Done } from "../lib/types";

const start = () =>
  newTurn(
    "Which header pin is RA4M1 port P102?",
    { model: "uno-r4-wifi", revision: null },
    "hybrid",
  );

function done(overrides: Partial<Done> = {}): Done {
  return {
    type: "done",
    status: "answered",
    answer: "P102 is D13 [1].",
    citations: [{ n: 1, id: "uno-r4-wifi-manual:pwm-u21:0" }],
    sources: [],
    safetyNotes: [],
    card: null,
    model: { id: "uno-r4-wifi", name: "Arduino UNO R4 WiFi", short: "R4 WiFi" },
    revision: null,
    readAs: [],
    explanation: null,
    generation: null,
    excluded: null,
    clarification: null,
    conversation: {
      topic: ["Which header pin is RA4M1 port P102?"],
      followUp: false,
    },
    timings: {},
    ...overrides,
  };
}

test("a turn fills in layer by layer and ends with the done event", () => {
  const events: AskEvent[] = [
    { type: "stage", stage: "retrieval" },
    { type: "token", delta: "P102 is " },
    { type: "token", delta: "D13 [1]." },
    done(),
  ];
  const turn = events.reduce(applyEvent, start());
  assert.equal(turn.streaming, false);
  assert.equal(turn.stage, null);
  assert.equal(turn.answer, "P102 is D13 [1].");
  assert.equal(turn.done?.status, "answered");
});

test("a retry throws away the failed attempt's reasoning", () => {
  let turn = applyEvent(start(), {
    type: "generation.attempt",
    model: "m",
    attempt: 1,
  });
  turn = applyEvent(turn, { type: "reasoning", delta: "thinking…" });
  turn = applyEvent(turn, {
    type: "generation.retry",
    model: "m",
    attempt: 1,
    reason: "rate limited (HTTP 429)",
  });
  assert.equal(turn.reasoning, "");
  assert.deepEqual(turn.attempts, [
    { model: "m", attempt: 1, ok: false, reason: "rate limited (HTTP 429)" },
  ]);
});

test("a clarification ends the turn with the choices and no answer", () => {
  const clarification = {
    reason: "no_model" as const,
    message: "Which model is this for?",
    question: "Which header pin is port P102?",
    candidates: [],
  };
  const turn = [
    { type: "clarification", clarification } as AskEvent,
    done({ status: "clarification", answer: null, clarification, model: null }),
  ].reduce(applyEvent, start());
  assert.equal(turn.clarification?.reason, "no_model");
  assert.equal(turn.done?.answer, null);
  assert.equal(turn.answer, "");
});

test("a stream that drops mid-answer says so and keeps what arrived", async () => {
  const encoder = new TextEncoder();
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0)
        controller.enqueue(
          encoder.encode('{"type":"stage","stage":"retrieval"}\n\n'),
        );
      else controller.error(new TypeError("network error"));
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(body, {
      headers: {
        [API_VERSION_HEADER]: "1",
        "Content-Type": "application/x-ndjson",
      },
    });
  try {
    const turn = await runTurn(
      start(),
      { message: "Which header pin is RA4M1 port P102?" },
      () => {},
      new AbortController().signal,
    );
    assert.equal(turn.streaming, false);
    assert.equal(
      turn.error,
      "The connection dropped before the answer finished. Try again.",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an error event ends the stream with its message", () => {
  const turn = applyEvent(start(), {
    type: "error",
    error: "Something went wrong on the server.",
  });
  assert.equal(turn.streaming, false);
  assert.equal(turn.error, "Something went wrong on the server.");
});
