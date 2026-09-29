---
title: Study Companion API
emoji: 📓
colorFrom: indigo
colorTo: yellow
sdk: gradio
sdk_version: 6.28.0
app_file: app.py
python_version: "3.12"
startup_duration_timeout: 30m
pinned: false
short_description: Explanations, quizzes and flashcards from your own notes
---

# Study Companion API

The Python backend for [Study Companion](https://github.com/Israel-Durotoye/rag-build-lab/tree/main/demos/02-study-companion),
with a small status page on the Space homepage. The full Next.js frontend uses
its versioned FastAPI routes to read a student's notes, chunk them two ways
(section-aware and fixed-length), retrieve with hybrid search, stream cited
explanations and write quizzes and flashcards that are checked against the
notes.

API documentation is at `/api/docs`, deployment status is at `/api/status`, and
every response carries `X-Study-API-Version` so the frontend can reject a stale
backend rather than silently using an incompatible contract.

## Configuration

Set `STUDY_MODEL_API_KEY` as a Space secret. Without it, extraction, chunking,
retrieval, the chunking lab and recall cards still work, and explanations are
sentences copied from the notes; generated explanations, overviews, quizzes and
flashcards are disabled.

The default provider, AgentRouter, is behind a web application firewall that
challenges requests from Hugging Face's datacenter addresses, so from a Space
use a provider that serves servers, for example Hugging Face Inference
Providers:

| Variable | Value |
|---|---|
| `STUDY_MODEL_BASE_URL` | `https://router.huggingface.co/v1` |
| `STUDY_MODEL` | `deepseek-ai/DeepSeek-V4-Flash` (or another id from `GET /v1/models`) |
| `STUDY_MODEL_API_KEY` | a Hugging Face token with the *inference* permission (billed to that account) |

Optional variables:

- `STUDY_MODEL_FALLBACKS`, `STUDY_MODEL_RETRIES`, `STUDY_MODEL_TIMEOUT_MS` — retries and fallback models.
- `STUDY_CORS_ORIGINS` — needed only for direct cross-origin browser calls;
  the recommended Next.js proxy needs no CORS setting.
- `STUDY_DATA_DIR` — defaults to ephemeral Space storage. Persistent storage
  is a paid option and is not enabled by this deployment.

The `AGENTROUTER_*` names that Campus Guide uses are read as well, after the
`STUDY_*` ones.

This is a Gradio ZeroGPU Space because free Hugging Face accounts cannot create
Docker or CPU Basic Spaces. The backend itself is CPU-only and normal use does
not request a GPU allocation.
