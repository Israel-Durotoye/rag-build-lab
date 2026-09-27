import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocuments, fitSections, sectionsFromPages } from "../lib/extract";
import { ingest, keywordSearch } from "../lib/retrieval";

test("PDF pages become titled sections with page citations", () => {
  const pages = [
    {
      page: 1,
      text: "STUDENT HANDBOOK\nDepartment of Mechatronics Engineering",
      ocr: false,
    },
    {
      page: 2,
      text: `Grading System\n${"The university operates a 5.0 grading scale. ".repeat(70)}`,
      ocr: true,
    },
    {
      page: 3,
      text: "Withdrawal\nA student on probation who fails to improve is withdrawn.",
      ocr: false,
    },
  ];
  const sections = sectionsFromPages(pages);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].location, "p. 1");
  assert.equal(sections[0].title, "STUDENT HANDBOOK");
  assert.equal(sections[1].location, "p. 2");
  assert.ok(sections[1].text.includes("5.0 grading scale"));
  assert.equal(sections[2].location, "p. 3");
});

test("short consecutive pages share one section with a page range", () => {
  const sections = sectionsFromPages([
    { page: 4, text: "Mission\nTo train engineers.", ocr: false },
    { page: 5, text: "Vision\nA world-class department.", ocr: false },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].location, "p. 4–5");
});

test("oversized pages are chunked under the shared section limit", () => {
  const sections = sectionsFromPages([
    { page: 6, text: "word ".repeat(2000), ocr: false },
  ]);
  assert.ok(sections.length >= 2);
  assert.ok(sections.every((section) => section.text.length <= 8000));
  assert.ok(sections.every((section) => section.location === "p. 6"));
});

test("fitSections enforces the knowledge-base budget with a truncation flag", () => {
  const many = Array.from({ length: 260 }, (_, index) => ({
    title: `Title ${index}`,
    text: "body",
    location: `p. ${index + 1}`,
  }));
  const fit = fitSections(many);
  assert.equal(fit.sections.length, 200);
  assert.equal(fit.truncated, true);
  assert.deepEqual(fitSections(many.slice(0, 5)), {
    sections: many.slice(0, 5),
    truncated: false,
  });
});

test("extracted sections build a valid, searchable document", () => {
  const documents = buildDocuments(
    "DOME_100_300HB-1",
    { source: "upload", format: "pdf" },
    [
      {
        title: "Grading System",
        text: "The university operates a 5.0 grading scale for degrees.",
        location: "p. 12",
      },
      {
        title: "Grading System",
        text: "A second mention with the same heading.",
        location: "p. 13",
      },
    ],
  );
  assert.equal(documents[0].id, "dome-100-300hb-1");
  assert.deepEqual(
    documents[0].sections.map((section) => section.id),
    ["grading-system", "grading-system-2"],
  );
  const corpus = ingest(documents);
  const hits = keywordSearch(corpus.sources, "What grading scale is used?");
  assert.equal(hits[0]?.section, "grading-system");
  assert.equal(hits[0]?.location, "p. 12");
  assert.ok(hits[0]?.citationLabel.includes("p. 12"));
});

test("tenant-tagged uploads are rejected end to end", () => {
  assert.throws(
    () =>
      buildDocuments("doc", { tenant: "alpha" }, [
        { title: "T", text: "Body", location: "p. 1" },
      ]),
    /Tenant/,
  );
});
