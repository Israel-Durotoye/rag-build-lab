import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "../app/api/search/route";
import { GET } from "../app/api/sources/[id]/route";

const original = { ...process.env };
beforeEach(() => {
  delete process.env.CAMPUS_OLLAMA_MODEL;
  delete process.env.CAMPUS_EMBEDDING_MODEL;
});
afterEach(() => {
  process.env = { ...original };
});
const request = (body: unknown) =>
  new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("search route returns cited public handbook passages and no-store header", async () => {
  const response = await POST(
    request({ question: "When does the library close?" }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "sources_found");
  assert.ok(
    body.sources.some(
      (source: { id: string }) => source.id === "handbook:library:0",
    ),
  );
  assert.ok(
    body.sources.every(
      (source: { documentId: string }) => source.documentId === "handbook",
    ),
  );
});

test("route rejects malformed, oversized and unsupported inputs", async () => {
  for (const body of [
    null,
    [],
    {},
    { question: 1 },
    { question: " " },
    { question: "x".repeat(4001) },
    { question: "library", previousQuestion: 5 },
    { question: "library", mode: "dense" },
    { question: "library", mode: "sql" },
    { question: "library", tenant: "beta" },
    { question: "library", corpus: "07-support-shelf" },
  ]) {
    assert.equal((await POST(request(body))).status, 400, JSON.stringify(body));
  }
  assert.equal(
    (
      await POST(
        new Request("http://localhost", { method: "POST", body: "{}" }),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "bad json",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await POST(request({ question: "x".repeat(33000) }))).status,
    413,
  );
});

test("source preview resolves an actual stored record and denies other demos", async () => {
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "handbook:library:0" }),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).source.text.includes("20:00"));
  for (const id of ["invented", "beta-support:returns:0", "../corpus.json"]) {
    assert.equal(
      (
        await GET(new Request("http://localhost"), {
          params: Promise.resolve({ id }),
        })
      ).status,
      404,
    );
  }
});

test("requests do not inherit another visitor's previous question", async () => {
  await POST(request({ question: "library hours" }));
  assert.equal(
    (await (await POST(request({ question: "What about weekends?" }))).json())
      .status,
    "clarification",
  );
});
