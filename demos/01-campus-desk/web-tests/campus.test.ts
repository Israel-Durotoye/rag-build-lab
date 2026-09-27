import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import documents from "../corpus.json";
import cases from "../evaluation.json";
import { handbook } from "../lib/handbook";
import { answer, ask, validateGeneration } from "../lib/pipeline";
import { cosine, fuse, ingest, search } from "../lib/retrieval";
import { parseSchoolDocuments, splitHandbookText } from "../lib/school";
import type { Generator } from "../lib/types";

test("ingestion preserves source identity, provenance, and stable revisions", () => {
  assert.equal(handbook.sources.length, documents[0].sections.length);
  assert.ok(handbook.sources.length >= 40, "the full handbook is indexed");
  for (const source of handbook.sources) {
    const section = documents[0].sections.find(
      (item) => item.id === source.section,
    )!;
    assert.equal(source.id, `handbook:${section.id}:0`);
    assert.equal(source.title, section.title);
    assert.equal(source.location, section.location);
    assert.equal(source.version, "2021-2025");
    assert.equal(
      source.contentHash,
      createHash("sha256").update(section.text).digest("hex"),
    );
  }
  assert.equal(ingest(documents).version, handbook.version);
  const edited = structuredClone(documents);
  edited[0].sections[0].text = "The department was founded in another year.";
  assert.notEqual(ingest(edited).version, handbook.version);
  assert.throws(() => ingest([...documents, ...documents]), /Duplicate/);
});

test("tenant-marked documents cannot enter the public web index", () => {
  assert.throws(
    () => ingest([{ ...documents[0], metadata: { tenant: "alpha" } }]),
    /Tenant/,
  );
  assert.throws(
    () =>
      parseSchoolDocuments([
        { ...structuredClone(documents[0]), metadata: { tenant: "alpha" } },
      ]),
    /Tenant/,
  );
});

test("the bundled corpus round-trips through the school validator", () => {
  const parsed = parseSchoolDocuments(structuredClone(documents));
  assert.equal(ingest(parsed).sources.length, handbook.sources.length);
});

test("school validator rejects malformed knowledge bases with plain messages", () => {
  assert.throws(() => parseSchoolDocuments([]), /at least one/);
  assert.throws(() => parseSchoolDocuments("handbook"), /at least one/);
  assert.throws(
    () => parseSchoolDocuments([{ id: "a", title: "A", sections: [] }]),
    /at least one section/,
  );
  assert.throws(
    () =>
      parseSchoolDocuments([
        {
          id: "Bad ID!",
          title: "A",
          sections: [{ id: "s", title: "S", text: "T" }],
        },
      ]),
    /lowercase/,
  );
  assert.throws(
    () =>
      parseSchoolDocuments([
        {
          id: "a",
          title: "A",
          sections: [{ id: "s", title: "S", text: "T", tenant: "x" }],
        },
      ]),
    /Unsupported section field/,
  );
  assert.throws(
    () =>
      parseSchoolDocuments([
        {
          id: "a",
          title: "A",
          extra: true,
          sections: [{ id: "s", title: "S", text: "T" }],
        },
      ]),
    /Unsupported document field/,
  );
  assert.throws(
    () =>
      parseSchoolDocuments([
        {
          id: "a",
          title: "A",
          sections: [{ id: "s", title: "S", text: "x".repeat(9000) }],
        },
      ]),
    /characters/,
  );
});

test("pasted handbook text splits into titled sections", () => {
  const sections = splitHandbookText(
    "2.7 Grading System\nThe university operates a 5.0 grading system.\n\nWITHDRAWAL\nA student on probation who fails to improve is withdrawn.",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["2.7 Grading System", "WITHDRAWAL"],
  );
  assert.ok(sections[0].text.includes("5.0 grading system"));
  const plain = splitHandbookText(
    "Just one paragraph without any heading at all.",
  );
  assert.equal(plain.length, 1);
  assert.ok(plain[0].text.includes("one paragraph"));
});

for (const item of cases) {
  test(`fixed evaluation: ${item.question}`, async () => {
    const result = await ask(handbook, item.question);
    assert.equal(result.answer, null);
    assert.equal(result.mode, "source_search");
    if (item.expected_source)
      assert.ok(
        result.sources.some((source) => source.id === item.expected_source),
      );
    else {
      assert.equal(result.status, item.expected_status);
      assert.equal(result.sources.length, 0);
    }
  });
}

test("keyword overlap is not turned into a fee answer", async () => {
  const result = await ask(handbook, "What are the library late fees?");
  assert.ok(result.sources.length);
  assert.equal(result.answer, null);
  assert.equal(result.status, "sources_found");
  assert.deepEqual(result.citations, []);
});

test("absent evidence never calls a model", async () => {
  const generator: Generator = {
    generate: async () => {
      assert.fail("Model must not be called");
    },
  };
  assert.equal(
    (await ask(handbook, "How much is tuition?", { generator })).status,
    "insufficient_evidence",
  );
});

test("citations must be in selected context, even for model abstention", async () => {
  const source = handbook.sources.find(
    (item) => item.id === "handbook:library-resources:0",
  )!;
  for (const citations of [
    ["unknown"],
    ["handbook:vision:0"],
    [source.id, "unknown"],
    [7],
  ]) {
    for (const insufficient of [false, true]) {
      assert.throws(() =>
        validateGeneration({ answer: "Claim", citations, insufficient }, [
          source,
        ]),
      );
    }
  }
  assert.throws(() =>
    validateGeneration(
      { answer: "Claim", citations: [], insufficient: false },
      [source],
    ),
  );
  assert.throws(() =>
    validateGeneration(
      { answer: " ", citations: [source.id], insufficient: false },
      [source],
    ),
  );
  const result = await answer("departmental e-library", [source], {
    generate: async () => ({
      answer: "The departmental e-Library is at the SICT Library.",
      citations: [source.id],
      insufficient: false,
    }),
  });
  assert.equal(result.status, "generated");
  assert.deepEqual(result.citations, [source.id]);
  assert.equal(
    source.citationLabel,
    "handbook · University Library and e-Library · §4.6.1–4.6.3 · v2021-2025",
  );
});

test("invalid generation and provider errors preserve sources without claiming an answer", async () => {
  for (const raw of [
    null,
    [],
    {},
    { answer: "Claim", citations: ["invented"], insufficient: false },
  ]) {
    const result = await ask(handbook, "library hours", {
      generator: { generate: async () => raw },
    });
    assert.equal(result.status, "generation_unavailable");
    assert.equal(result.answer, null);
    assert.ok(result.sources.length);
  }
  const result = await ask(handbook, "library", {
    generator: {
      generate: async () => {
        throw new Error("private provider error");
      },
    },
  });
  assert.equal(result.status, "generation_unavailable");
  assert.ok(!result.notice.includes("private provider error"));
});

test("model abstention drops unsupported answer text", async () => {
  const result = await ask(handbook, "library fees", {
    generator: {
      generate: async () => ({
        answer: "Invented fee",
        citations: [],
        insufficient: true,
      }),
    },
  });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.answer, null);
  assert.ok(result.sources.length);
});

test("follow-ups require explicit client context and use it for generation", async () => {
  assert.equal(
    (await ask(handbook, "What about weekends?")).status,
    "clarification",
  );
  let generatedQuestion = "";
  const result = await ask(handbook, "What about weekends?", {
    previousQuestion: "library hours",
    generator: {
      generate: async (query) => {
        generatedQuestion = query;
        return {
          answer: "The handbook describes the library collections.",
          citations: ["handbook:library-resources:0"],
          insufficient: false,
        };
      },
    },
  });
  assert.ok(
    result.sources.some((source) => source.section === "library-resources"),
  );
  assert.ok(generatedQuestion.includes("library hours"));
  assert.equal(
    (await ask(handbook, "What about weekends?")).status,
    "clarification",
  );
});

test("dense retrieval and reciprocal rank fusion use the configured adapter", async () => {
  // Deliberate test vectors; no claim of live semantic-model quality.
  const embedder = {
    embed: async (texts: string[]) =>
      texts.map((text, i) =>
        i === 0 || text.startsWith("University Library") ? [1, 0] : [0, 1],
      ),
  };
  assert.equal(
    (await search(handbook, "reading room", "dense", embedder))[0].section,
    "library-resources",
  );
  assert.ok((await search(handbook, "library", "hybrid", embedder)).length);
  await assert.rejects(search(handbook, "library", "dense"), /not configured/);
  await assert.rejects(
    search(handbook, "library", "dense", { embed: async () => [[1]] }),
    /count mismatch/,
  );
  assert.throws(() => cosine([1], [1, 2]));
  assert.throws(() => cosine([NaN], [1]));
  assert.equal(cosine([0], [0]), 0);
  const [a, b] = handbook.sources;
  assert.deepEqual(
    fuse([
      [a, b],
      [b, a],
    ]).map((source) => source.id),
    [a.id, b.id].sort(),
  );
});

test("blank, oversized, and punctuation-only questions are handled", async () => {
  await assert.rejects(ask(handbook, " "));
  await assert.rejects(ask(handbook, "x".repeat(4001)));
  assert.equal((await ask(handbook, "!!!")).status, "insufficient_evidence");
});
