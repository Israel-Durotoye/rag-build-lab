import assert from "node:assert/strict";
import { test } from "node:test";
import {
  API_VERSION,
  backendProblem,
  isCompatibleHealth,
} from "../lib/contract";

test("the frontend accepts only its matching backend API contract", () => {
  assert.equal(
    isCompatibleHealth({ status: "ok", apiVersion: API_VERSION }),
    true,
  );
  assert.equal(
    isCompatibleHealth({ status: "ok", apiVersion: API_VERSION + 1 }),
    false,
  );
  assert.equal(isCompatibleHealth({ status: "ok" }), false);
  assert.equal(isCompatibleHealth(null), false);
});

test("a reply with the matching contract header is accepted whatever its status", () => {
  const header = String(API_VERSION);
  assert.equal(backendProblem({ ok: true, versionHeader: header }), null);
  assert.equal(backendProblem({ ok: false, versionHeader: header }), null);
});

test("a proxy or host error page without the header is 'unreachable', not stale", () => {
  // A sleeping Space, a Vercel rewrite that points nowhere, a 502 from the host.
  assert.equal(
    backendProblem({ ok: false, versionHeader: null }),
    "unreachable",
  );
});

test("a backend that never sends the header, or sends another version, is incompatible", () => {
  assert.equal(
    backendProblem({ ok: true, versionHeader: null }),
    "incompatible",
  );
  assert.equal(
    backendProblem({ ok: true, versionHeader: String(API_VERSION + 1) }),
    "incompatible",
  );
  assert.equal(
    backendProblem({ ok: false, versionHeader: String(API_VERSION - 1) }),
    "incompatible",
  );
});
