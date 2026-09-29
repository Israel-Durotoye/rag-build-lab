---
title: Campus Guide API
emoji: 🎓
colorFrom: green
colorTo: gray
sdk: gradio
sdk_version: 6.28.0
app_file: app.py
python_version: "3.12"
startup_duration_timeout: 30m
pinned: false
short_description: Cited answers from a school's own documents
---

# Campus Guide API

The Python backend for [Campus Guide](https://github.com/Israel-Durotoye/rag-build-lab/tree/main/demos/01-campus-desk),
with a small operational demo on the Space homepage. The full Next.js frontend
uses its versioned FastAPI routes for document extraction, hybrid retrieval and
streamed citation-checked answers.

API documentation is at `/api/docs`, deployment status is at `/api/status`, and every
response carries `X-Campus-API-Version` so the frontend can reject a stale
backend rather than silently using an incompatible contract.

## Configuration

Set `AGENTROUTER_API_KEY` as a Space secret. Without it, document extraction
and retrieval still work, but generated answers, profiles and overviews are
disabled.

AgentRouter itself is behind a web application firewall that challenges
requests from Hugging Face's datacenter addresses, so from a Space the key must
belong to a provider that serves servers, for example Hugging Face Inference
Providers: `AGENTROUTER_BASE_URL=https://router.huggingface.co/v1`,
`AGENTROUTER_MODEL=deepseek-ai/DeepSeek-V4-Flash` and a Hugging Face token
with the inference permission as `AGENTROUTER_API_KEY`. Optional variables:

- `AGENTROUTER_BASE_URL` — any OpenAI-compatible endpoint; defaults to AgentRouter.
- `AGENTROUTER_MODEL` — defaults to `deepseek-v4-flash`.
- `CAMPUS_CORS_ORIGINS` — needed only for direct cross-origin browser calls;
  the recommended Next.js proxy needs no CORS setting.
- `CAMPUS_DATA_DIR` — defaults to ephemeral Space storage. Persistent storage
  is a paid option and is not enabled by this deployment.

This is a Gradio ZeroGPU Space because free Hugging Face accounts cannot create
Docker or CPU Basic Spaces. The backend itself is CPU-only and normal use does
not request a GPU allocation.
