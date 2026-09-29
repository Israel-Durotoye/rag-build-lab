import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/markdown";

function render(text: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

const CITE = (n: number) =>
  `<button type="button" class="cite" aria-label="Show source ${n}">${n}</button>`;

test("a citation keeps the full stop after it on the same line", () => {
  assert.equal(
    render("Stability must be checked separately [1]. Gain matters [2]"),
    `<div class="markdown"><p>Stability must be checked separately <span class="nowrap">${CITE(1)}.</span> Gain matters ${CITE(2)}</p></div>`,
  );
});

test("punctuation is shown once, and only after the last of several citations", () => {
  const html = render("It can oscillate [1][2], or diverge [3]; check it.");
  assert.equal(
    html,
    `<div class="markdown"><p>It can oscillate ${CITE(1)}<span class="nowrap">${CITE(2)},</span> or diverge <span class="nowrap">${CITE(3)};</span> check it.</p></div>`,
  );
  assert.equal(
    html.replace(/<[^>]+>/g, ""),
    "It can oscillate 12, or diverge 3; check it.",
  );
});

test("citations inside lists and bold text are rendered the same way", () => {
  assert.equal(
    render("- **No** guarantee [1].\n- Check stability [2]"),
    `<div class="markdown"><ul><li><strong>No</strong> guarantee <span class="nowrap">${CITE(1)}.</span></li><li>Check stability ${CITE(2)}</li></ul></div>`,
  );
});

test("text from the notes is never rendered as HTML", () => {
  assert.equal(
    render('<img src=x onerror="alert(1)"> [1]'),
    `<div class="markdown"><p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; ${CITE(1)}</p></div>`,
  );
});
