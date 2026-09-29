import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixedWindows,
  formatMs,
  markFragment,
  plural,
  readingMinutes,
  sectionOf,
} from "../lib/text";

const NOTES =
  "Definition: negative feedback subtracts the measured output.\n\nImportant exception: negative feedback does not guarantee stability.";

test("fixed windows hold the chosen number of words and rebuild the text", () => {
  const windows = fixedWindows(NOTES, 5);
  assert.deepEqual(
    windows.map((w) => w.words),
    [5, 5, 5],
  );
  assert.deepEqual(
    windows.map((w) => w.piece),
    [1, 2, 3],
  );
  assert.equal(windows.map((w) => w.text).join(""), NOTES);
  assert.equal(windows[0].text, "Definition: negative feedback subtracts the");
});

test("the last window holds what is left, and a short text is one window", () => {
  assert.deepEqual(
    fixedWindows("one two three four five six seven", 3).map((w) => w.words),
    [3, 3, 1],
  );
  assert.equal(fixedWindows("  leading space", 50)[0].text, "leading space");
  assert.deepEqual(fixedWindows("", 50), []);
  assert.deepEqual(fixedWindows("   \n ", 50), []);
  assert.deepEqual(fixedWindows("words here", 0), []);
});

test("a short last window joins the one before it", () => {
  const text = Array.from({ length: 101 }, (_, i) => `w${i}`).join(" ");
  assert.deepEqual(
    fixedWindows(text, 50).map((w) => w.words),
    [50, 50, 1],
  );
  const joined = fixedWindows(text, 50, 12);
  assert.deepEqual(
    joined.map((w) => [w.piece, w.words]),
    [
      [1, 50],
      [2, 51],
    ],
  );
  assert.equal(joined.map((w) => w.text).join(""), text);
  assert.ok(joined[1].text.endsWith("w99 w100"));
  // A tail that is long enough stays a window of its own, and a lone window is never joined.
  assert.deepEqual(
    fixedWindows(text, 45, 11).map((w) => w.words),
    [45, 45, 11],
  );
  assert.deepEqual(
    fixedWindows("only three words", 50, 12).map((w) => w.words),
    [3],
  );
});

test("windows cut the way the backend's fixed chunking does", () => {
  // rag_core joins each window's words with single spaces.
  const words = NOTES.split(/\s+/);
  const backend = [0, 5, 10].map((i) => words.slice(i, i + 5).join(" "));
  assert.deepEqual(
    fixedWindows(NOTES, 5).map((w) => w.text.trim().split(/\s+/).join(" ")),
    backend,
  );
});

test("a fragment is found in its section despite different spacing", () => {
  const fragment = "measured output. Important exception: negative feedback";
  const runs = markFragment(NOTES, fragment);
  assert.deepEqual(
    runs.map((r) => r.marked),
    [false, true, false],
  );
  assert.equal(
    runs[1].text,
    "measured output.\n\nImportant exception: negative feedback",
  );
  assert.equal(runs.map((r) => r.text).join(""), NOTES);
});

test("a fragment at the start or end leaves no empty run", () => {
  const start = markFragment(NOTES, "Definition: negative feedback");
  assert.deepEqual(
    start.map((r) => r.marked),
    [true, false],
  );
  const end = markFragment(NOTES, "does not guarantee stability.");
  assert.deepEqual(
    end.map((r) => r.marked),
    [false, true],
  );
});

test("the whole section, or text that is not in it, is left unmarked", () => {
  assert.deepEqual(markFragment(NOTES, NOTES), [
    { text: NOTES, marked: false },
  ]);
  assert.deepEqual(markFragment(NOTES, "Kalman filter"), [
    { text: NOTES, marked: false },
  ]);
  assert.deepEqual(markFragment(NOTES, "   "), [
    { text: NOTES, marked: false },
  ]);
});

test("punctuation in a fragment is matched literally", () => {
  const text = "Gain (K) scales the error. Is K * e(t) enough? Not always.";
  const runs = markFragment(text, "Is K * e(t) enough?");
  assert.equal(runs.find((r) => r.marked)?.text, "Is K * e(t) enough?");
});

test("small formatters", () => {
  assert.equal(plural(1, "section"), "1 section");
  assert.equal(plural(2, "match", "matches"), "2 matches");
  assert.equal(plural(1200, "word"), "1,200 words");
  assert.equal(formatMs(0.4), "<1 ms");
  assert.equal(formatMs(412.6), "413 ms");
  assert.equal(formatMs(2340), "2.3 s");
  assert.equal(formatMs(undefined), "—");
  assert.equal(readingMinutes(40), 1);
  assert.equal(readingMinutes(900), 5);
  assert.equal(sectionOf("controls:feedback"), "feedback");
  assert.equal(sectionOf("my-notes-ab12cd:s003"), "s003");
});
