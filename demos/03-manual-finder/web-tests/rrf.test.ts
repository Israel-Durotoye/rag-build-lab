import assert from "node:assert/strict";
import { test } from "node:test";
import { arithmetic, fuse } from "../lib/rrf";

test("ranks are fused with 1/(constant + rank), not raw scores", () => {
  const fused = fuse(
    [
      ["a", "b", "c"],
      ["c", "a"],
    ],
    60,
  );
  assert.deepEqual(
    fused.map((f) => f.id),
    ["a", "c", "b"],
  );
  assert.equal(fused[0].score, Math.round((1 / 61 + 1 / 62) * 1e6) / 1e6);
  assert.deepEqual(fused[1].ranks, [3, 1]);
  assert.equal(fused[2].ranks[1], null);
});

test("mirror-image ranks tie exactly and fall back to the passage ID", () => {
  const fused = fuse(
    [
      ["b", "a"],
      ["a", "b"],
    ],
    60,
  );
  assert.deepEqual(
    fused.map((f) => [f.id, f.tied]),
    [
      ["a", true],
      ["b", true],
    ],
  );
});

test("a tie goes first to the better best single rank", () => {
  // 2/(60+62) equals 1/(60+1) exactly: "z" was ranked 1st by one retriever,
  // "a" only 62nd by both, so "z" wins the tie despite its later ID.
  const keyword = Array.from({ length: 62 }, (_, i) => `k${i}`);
  keyword[0] = "z";
  keyword[61] = "a";
  const semantic = Array.from({ length: 62 }, (_, i) => `s${i}`);
  semantic[61] = "a";
  const fused = fuse([keyword, semantic], 60);
  const z = fused.findIndex((f) => f.id === "z");
  const a = fused.findIndex((f) => f.id === "a");
  assert.ok(fused[z].tied && fused[a].tied);
  assert.ok(z < a);
  const byId = fuse([keyword, semantic], 60, "id");
  assert.ok(
    byId.findIndex((f) => f.id === "a") < byId.findIndex((f) => f.id === "z"),
  );
});

test("the order never depends on the order of the inputs", () => {
  const one = fuse(
    [
      ["x", "y", "z"],
      ["z", "y", "x"],
    ],
    10,
  );
  const two = fuse(
    [
      ["z", "y", "x"],
      ["x", "y", "z"],
    ],
    10,
  );
  assert.deepEqual(
    one.map((f) => f.id),
    two.map((f) => f.id),
  );
});

test("a small constant rewards one top rank, a large one rewards agreement", () => {
  // "a" is 1st for keyword search only; "b" is 4th for both retrievers.
  const rankings: [string[], string[]] = [
    ["a", "x", "y", "b"],
    ["p", "q", "r", "b"],
  ];
  const order = (constant: number) => fuse(rankings, constant).map((f) => f.id);
  // 1/(1+1) = 0.5 beats 2/(1+4) = 0.4 ...
  assert.ok(order(1).indexOf("a") < order(1).indexOf("b"));
  // ... while 2/(60+4) = 0.031 beats 1/(60+1) = 0.016.
  assert.ok(order(60).indexOf("b") < order(60).indexOf("a"));
  assert.throws(() => fuse([["a"], []], 0), RangeError);
});

test("the arithmetic is written out for each passage", () => {
  assert.equal(arithmetic([2, 5], 60), "1/(60+2) + 1/(60+5)");
  assert.equal(arithmetic([null, 3], 60), "1/(60+3)");
});
