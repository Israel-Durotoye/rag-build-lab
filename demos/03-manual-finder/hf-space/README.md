---
title: Finder API
emoji: 🔎
colorFrom: gray
colorTo: green
sdk: gradio
sdk_version: 6.28.0
app_file: app.py
python_version: "3.12"
startup_duration_timeout: 30m
pinned: false
short_description: The exact manual passage for the exact device model
---

# Finder API

The Python backend for [Finder](https://github.com/Israel-Durotoye/rag-build-lab/tree/main/demos/03-manual-finder),
with a small status page on the Space homepage. The Next.js frontend uses its
versioned FastAPI routes to search device manuals by fault code or symptom,
filtered to one model (and revision) before ranking, with keyword, semantic
and hybrid retrieval, exact-code lookup and cited answers.

API documentation is at `/api/docs`, deployment status is at `/api/status`, and
every response carries `X-Manual-API-Version` so the frontend can reject a
stale backend rather than silently using an incompatible contract.

The sample library is real documentation from Raspberry Pi Ltd and Arduino
under CC BY-SA 4.0: see `NOTICE.md` and `LICENSE.txt`. Finder is not
affiliated with or endorsed by either company.

## Configuration

Set `MANUAL_MODEL_API_KEY` as a Space secret. Without it, searching, the
code index, the search-mode lab and the evaluation still work, and answers are
sentences copied from the manuals; model-written answers are disabled.

The default provider, AgentRouter, challenges requests from Hugging Face's
datacenter addresses, so from a Space use a provider that serves servers, for
example Hugging Face Inference Providers:

| Variable | Value |
|---|---|
| `MANUAL_MODEL_BASE_URL` | `https://router.huggingface.co/v1` |
| `MANUAL_MODEL` | `deepseek-ai/DeepSeek-V4-Flash` (or another id from `GET /v1/models`) |
| `MANUAL_MODEL_API_KEY` | a Hugging Face token with the *inference* permission (billed to that account) |

Optional: `MANUAL_MODEL_FALLBACKS`, `MANUAL_MODEL_RETRIES`,
`MANUAL_MODEL_TIMEOUT_MS`, `MANUAL_CORS_ORIGINS` (only for direct cross-origin
browser calls) and `MANUAL_DATA_DIR` (defaults to ephemeral Space storage;
uploaded manuals disappear when the Space restarts). The `AGENTROUTER_*`
names the other sites use are read after the `MANUAL_*` ones.

This is a Gradio ZeroGPU Space because free Hugging Face accounts cannot create
Docker or CPU Basic Spaces. The backend itself is CPU-only and normal use does
not request a GPU allocation.
