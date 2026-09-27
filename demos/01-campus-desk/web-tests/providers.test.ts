import assert from "node:assert/strict";
import { test } from "node:test";
import { handbook } from "../lib/handbook";
import { capabilities, providers } from "../lib/providers";

test("default mode requires no model service", () => {
  assert.deepEqual(providers({}), {});
  assert.deepEqual(capabilities({}), { generation: false, modes: ["keyword"] });
});

test("Ollama request contracts use configurable models and keep credentials server-side", async (context) => {
  const calls: { url: string; payload: Record<string, unknown> }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (url: URL, options: RequestInit) => {
      calls.push({
        url: url.toString(),
        payload: JSON.parse(options.body as string),
      });
      assert.equal(
        (options.headers as Record<string, string>).Authorization,
        "Bearer test-token",
      );
      return Response.json(
        url.pathname === "/api/chat"
          ? {
              message: {
                content: JSON.stringify({
                  answer: "Test response",
                  citations: [handbook.sources[0].id],
                  insufficient: false,
                }),
              },
            }
          : {
              embeddings: [
                [1, 0],
                [0, 1],
              ],
            },
      );
    },
  );
  const adapters = providers({
    CAMPUS_OLLAMA_MODEL: "test-generator",
    CAMPUS_EMBEDDING_MODEL: "test-embedder",
    CAMPUS_OLLAMA_HOST: "https://models.example.test",
    CAMPUS_OLLAMA_TOKEN: "test-token",
  });
  await adapters.generator!.generate("library", [handbook.sources[0]]);
  await adapters.embedder!.embed(["one", "two"]);
  assert.equal(calls[0].url, "https://models.example.test/api/chat");
  assert.equal(calls[0].payload.model, "test-generator");
  assert.equal(calls[0].payload.stream, false);
  assert.equal(calls[1].url, "https://models.example.test/api/embed");
  assert.deepEqual(calls[1].payload.input, ["one", "two"]);
  assert.equal(calls[1].payload.truncate, false);
});

test("bad model configuration fails explicitly", () => {
  assert.throws(() =>
    providers({
      CAMPUS_OLLAMA_MODEL: "x",
      CAMPUS_OLLAMA_HOST: "file:///tmp/model",
    }),
  );
  assert.throws(() =>
    providers({ CAMPUS_OLLAMA_MODEL: "x", CAMPUS_MODEL_TIMEOUT_MS: "0" }),
  );
  assert.throws(() =>
    providers({ CAMPUS_OLLAMA_MODEL: "x", CAMPUS_MODEL_TIMEOUT_MS: "oops" }),
  );
});
