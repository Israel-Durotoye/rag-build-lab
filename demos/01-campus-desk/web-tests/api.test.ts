import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "../app/api/search/route";
import fixture from "../corpus.json";

const original = { ...process.env };
beforeEach(() => {
  delete process.env.AGENTROUTER_API_KEY;
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

const customSchool = {
  id: "unilag",
  title: "UNILAG Students' Handbook",
  version: "2024",
  metadata: { school: "University of Lagos" },
  sections: [
    {
      id: "matriculation",
      title: "Matriculation oath",
      text: "Every fresh student swears the matriculation oath during the matriculation ceremony in the first semester.",
      location: "part-1",
    },
    {
      id: "id-cards",
      title: "Identity cards",
      text: "Identity cards are issued after screening and must be worn on campus at all times.",
      location: "part-2",
    },
  ],
};

test("searching without an uploaded document is refused", async () => {
  const response = await POST(request({ question: "Where is the library?" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /document/i);
});

test("search runs over the supplied document and returns cited passages", async () => {
  const response = await POST(
    request({
      question: "Where is the departmental e-library?",
      documents: fixture,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "sources_found");
  assert.ok(
    body.sources.some(
      (source: { id: string }) => source.id === "handbook:library-resources:0",
    ),
  );
  assert.ok(
    body.sources.every(
      (source: { documentId: string }) => source.documentId === "handbook",
    ),
  );
});

test("one visitor's document never leaks into another's request", async () => {
  const response = await POST(
    request({
      question: "When do fresh students swear the matriculation oath?",
      documents: [customSchool],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "sources_found");
  assert.ok(
    body.sources.some(
      (source: { id: string }) => source.id === "unilag:matriculation:0",
    ),
  );
  assert.ok(
    body.sources.every(
      (source: { documentId: string }) => source.documentId === "unilag",
    ),
  );
  // The next request only sees the documents it carries itself.
  const next = await POST(
    request({
      question: "Where is the departmental e-library?",
      documents: fixture,
    }),
  );
  assert.ok(
    (await next.json()).sources.every(
      (source: { documentId: string }) => source.documentId === "handbook",
    ),
  );
});

test("invalid knowledge bases are rejected with a clear message", async () => {
  for (const documents of [
    "not-documents",
    [],
    [{ ...customSchool, sections: [] }],
    [{ ...customSchool, id: "Bad ID!" }],
    [{ ...customSchool, extra: true }],
    [
      {
        ...customSchool,
        sections: [{ id: "s", title: "S", text: "T", secret: "x" }],
      },
    ],
  ]) {
    const response = await POST(request({ question: "oath", documents }));
    assert.equal(response.status, 400, JSON.stringify(documents).slice(0, 80));
  }
  const tenant = await POST(
    request({
      question: "oath",
      documents: [{ ...customSchool, metadata: { tenant: "alpha" } }],
    }),
  );
  assert.equal(tenant.status, 400);
  assert.match((await tenant.json()).error, /Tenant/);
});

test("route rejects malformed, oversized and unsupported inputs", async () => {
  for (const body of [
    null,
    [],
    {},
    { question: 1 },
    { question: " " },
    { question: "x".repeat(4001) },
    { question: "x".repeat(33000) },
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
    (await POST(request({ question: "x".repeat(1_100_000) }))).status,
    413,
  );
});

test("requests do not inherit another visitor's previous question", async () => {
  await POST(request({ question: "library hours", documents: fixture }));
  assert.equal(
    (
      await (
        await POST(
          request({ question: "What about weekends?", documents: fixture }),
        )
      ).json()
    ).status,
    "clarification",
  );
});
