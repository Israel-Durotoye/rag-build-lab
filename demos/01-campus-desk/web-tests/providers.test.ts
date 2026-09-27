import assert from "node:assert/strict";
import { test } from "node:test";
import { handbook } from "../lib/handbook";
import { capabilities, modelLabel, providers } from "../lib/providers";

test("default mode requires no model service", () => {
  assert.deepEqual(providers({}), {});
  assert.deepEqual(capabilities({}), { generation: false, modes: ["keyword"] });
  assert.equal(modelLabel({}), "deepseek-v4-flash");
});

test("AgentRouter requests keep the key server-side and parse fenced JSON", async (context) => {
  const calls: {
    url: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
  }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (url: URL, options: RequestInit) => {
      calls.push({
        url: url.toString(),
        headers: options.headers as Record<string, string>,
        payload: JSON.parse(options.body as string),
      });
      return Response.json({
        choices: [
          {
            message: {
              reasoning_content: "hidden chain of thought",
              content: `\`\`\`json\n${JSON.stringify({
                answer: "Test response",
                citations: [handbook.sources[0].id],
                insufficient: false,
              })}\n\`\`\``,
            },
          },
        ],
      });
    },
  );
  const adapters = providers({ AGENTROUTER_API_KEY: "test-key" });
  assert.equal(adapters.generator!.label, "deepseek-v4-flash via AgentRouter");
  const raw = (await adapters.generator!.generate("library", [
    handbook.sources[0],
  ])) as Record<string, unknown>;
  assert.equal(raw.answer, "Test response");
  assert.equal(calls[0].url, "https://agentrouter.org/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
  assert.ok(calls[0].headers["User-Agent"]);
  assert.equal(calls[0].payload.model, "deepseek-v4-flash");
  assert.equal(calls[0].payload.stream, false);
  assert.equal(calls[0].payload.temperature, 0);
  const messages = calls[0].payload.messages as { content: string }[];
  assert.ok(messages[1].content.includes("untrusted_sources"));
});

test("model and base URL are configurable", async (context) => {
  const seen: { url: string; model: unknown }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (url: URL, options: RequestInit) => {
      seen.push({
        url: url.toString(),
        model: JSON.parse(options.body as string).model,
      });
      return Response.json({
        choices: [{ message: { content: '{"answer":"ok"}' } }],
      });
    },
  );
  const adapters = providers({
    AGENTROUTER_API_KEY: "k",
    AGENTROUTER_BASE_URL: "https://relay.example.test/api/v1",
    AGENTROUTER_MODEL: "deepseek-r2",
  });
  assert.equal(modelLabel({ AGENTROUTER_MODEL: "deepseek-r2" }), "deepseek-r2");
  assert.equal(adapters.generator!.label, "deepseek-r2 via AgentRouter");
  await adapters.generator!.generate("q", []);
  assert.equal(seen[0].url, "https://relay.example.test/api/v1/chat/completions");
  assert.equal(seen[0].model, "deepseek-r2");
});

test("bad configuration and bad responses fail explicitly", async (context) => {
  assert.throws(() =>
    providers({
      AGENTROUTER_API_KEY: "k",
      AGENTROUTER_BASE_URL: "file:///tmp/model",
    }),
  );
  assert.throws(() =>
    providers({ AGENTROUTER_API_KEY: "k", AGENTROUTER_TIMEOUT_MS: "0" }),
  );
  assert.throws(() =>
    providers({ AGENTROUTER_API_KEY: "k", AGENTROUTER_TIMEOUT_MS: "oops" }),
  );
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: "" } }] }),
  );
  await assert.rejects(
    providers({ AGENTROUTER_API_KEY: "k" }).generator!.generate("q", []),
    /Empty model response/,
  );
  context.mock.method(
    globalThis,
    "fetch",
    async () => new Response("nope", { status: 500 }),
  );
  await assert.rejects(
    providers({ AGENTROUTER_API_KEY: "k" }).generator!.generate("q", []),
    /unavailable/,
  );
});
