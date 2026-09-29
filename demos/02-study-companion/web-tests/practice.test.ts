import assert from "node:assert/strict";
import { test } from "node:test";
import { deckProgress, scoreQuiz, shuffled } from "../lib/practice";

const ITEMS = [
  { id: "i01", answer: 2 },
  { id: "i02", answer: 0 },
  { id: "i03", answer: 3 },
  { id: "i04", answer: 1 },
];

test("a quiz is scored on the questions answered so far", () => {
  assert.deepEqual(scoreQuiz(ITEMS, {}), {
    answered: 0,
    correct: 0,
    total: 4,
    percent: 0,
    missed: [],
  });
  assert.deepEqual(scoreQuiz(ITEMS, { i01: 2, i02: 1 }), {
    answered: 2,
    correct: 1,
    total: 4,
    percent: 50,
    missed: ["i02"],
  });
});

test("a finished quiz lists what was missed in the order it was asked", () => {
  const score = scoreQuiz(ITEMS, { i04: 0, i01: 2, i03: 3, i02: 3 });
  assert.equal(score.correct, 2);
  assert.equal(score.percent, 50);
  assert.deepEqual(score.missed, ["i02", "i04"]);
});

test("choosing option 0 counts as an answer", () => {
  const score = scoreQuiz(ITEMS, { i02: 0 });
  assert.equal(score.answered, 1);
  assert.equal(score.correct, 1);
});

test("answers to questions outside the current round are ignored", () => {
  const retry = ITEMS.filter((item) => item.id === "i02");
  assert.deepEqual(scoreQuiz(retry, { i01: 0, i02: 0 }), {
    answered: 1,
    correct: 1,
    total: 1,
    percent: 100,
    missed: [],
  });
});

test("a deck is done when every card has been marked", () => {
  const ids = ["i01", "i02", "i03"];
  assert.deepEqual(deckProgress(ids, { i01: "known" }), {
    known: 1,
    again: 0,
    remaining: 2,
    done: false,
  });
  assert.deepEqual(
    deckProgress(ids, { i01: "known", i02: "again", i03: "known" }),
    { known: 2, again: 1, remaining: 0, done: true },
  );
  assert.equal(deckProgress([], {}).done, false);
});

test("shuffling keeps every item and leaves the original alone", () => {
  const original = [1, 2, 3, 4, 5, 6];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const result = shuffled(original, random);
  assert.deepEqual(original, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...result].sort(), original);
  assert.notDeepEqual(result, original);
});
