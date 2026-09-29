import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown } from "../lib/markdown";

test("citation markers become citation nodes", () => {
  assert.deepEqual(parseInline("SIWES II is 24 weeks [1][3]."), [
    { type: "text", text: "SIWES II is 24 weeks " },
    { type: "cite", n: 1 },
    { type: "cite", n: 3 },
    { type: "text", text: "." },
  ]);
});

test("bold, italic and code nest and keep citations", () => {
  assert.deepEqual(
    parseInline("You need **4.50 [2]** and *a pass* in `EET 211`"),
    [
      { type: "text", text: "You need " },
      {
        type: "strong",
        children: [
          { type: "text", text: "4.50 " },
          { type: "cite", n: 2 },
        ],
      },
      { type: "text", text: " and " },
      { type: "em", children: [{ type: "text", text: "a pass" }] },
      { type: "text", text: " in " },
      { type: "code", text: "EET 211" },
    ],
  );
});

test("paragraphs, headings and both list kinds are recognised", () => {
  const blocks = parseMarkdown(
    "### Grades\nA First Class needs\n4.50 or more.\n\n- one\n- two\n  continued\n1. first\n2. second",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "list", "list"],
  );
  assert.deepEqual(blocks[1], {
    type: "paragraph",
    children: [{ type: "text", text: "A First Class needs 4.50 or more." }],
  });
  const bullets = blocks[2];
  assert.ok(bullets.type === "list" && !bullets.ordered);
  assert.deepEqual(bullets.items[1], [{ type: "text", text: "two continued" }]);
  assert.ok(blocks[3].type === "list" && blocks[3].ordered);
});

test("text that only looks like markup is left alone", () => {
  assert.deepEqual(parseInline("Scores [100] and 2 * 3 * 4"), [
    { type: "text", text: "Scores [100] and 2 * 3 * 4" },
  ]);
  assert.deepEqual(parseMarkdown(""), []);
});
