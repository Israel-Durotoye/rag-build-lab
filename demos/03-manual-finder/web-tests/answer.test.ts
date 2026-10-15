import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askable,
  comparable,
  renamed,
  withCode,
} from "../components/answer/shared";
import type { Mention } from "../lib/types";

test("passages are compared without case, punctuation or spacing", () => {
  assert.equal(
    comparable("D13 | P102 | GTIOC2B"),
    comparable("d13 p102  gtioc2b"),
  );
  assert.notEqual(comparable("D5 | P102"), comparable("D13 | P102"));
});

test("a flash code is asked the way the backend reads it", () => {
  assert.equal(askable("4 long · 4 short", "flash"), "4 long, 4 short");
  assert.equal(askable("P102", "token"), "P102");
});

test("'Did you mean' swaps the code the question wrote for the suggestion", () => {
  assert.equal(
    withCode("What is P120 on the board?", ["P120"], "P102"),
    "What is P102 on the board?",
  );
});

test("choosing a model renames the model the question named", () => {
  const mentions: Mention[] = [
    {
      alias: "Pi 3",
      kind: "family",
      models: ["rpi-3b", "rpi-3b-plus"],
      revision: null,
      start: 8,
      end: 12,
    },
  ];
  assert.equal(
    renamed("Does my Pi 3 boot from USB?", mentions, "Raspberry Pi 3 Model B+"),
    "Does my Raspberry Pi 3 Model B+ boot from USB?",
  );
});
