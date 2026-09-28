---
title: Campus Guide API
emoji: 🎓
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Python backend for Campus Guide, a cited-answer guide built from a school's documents
---

# Campus Guide API

The Python backend for [Campus Guide](https://github.com/Israel-Durotoye/rag-build-lab/tree/main/demos/01-campus-desk):
document extraction (PyMuPDF, RapidOCR, python-docx), hybrid retrieval
(FastEmbed embeddings + stemmed SQLite FTS5 via `rag_core`, fused with RRF) and
streamed, citation-checked answers from DeepSeek through AgentRouter.

Once the Space is running, its API docs are at `/api/docs` and its health check
at `/api/health`.

## Settings

Add these under **Settings → Variables and secrets** on the Space:

| Name | Kind | Value |
|---|---|---|
| `AGENTROUTER_API_KEY` | Secret | your AgentRouter key (without it the API retrieves passages but writes no answers) |
| `AGENTROUTER_MODEL` | Variable | `deepseek-v4-flash` (default) |
| `CAMPUS_CORS_ORIGINS` | Variable | only if a browser will call this Space directly, e.g. `https://your-frontend.vercel.app` |
| `CAMPUS_DATA_DIR` | Variable | `/data` if you enable persistent storage; otherwise leave unset (documents are lost when the Space restarts) |

The frontend (Next.js) proxies `/api/*` to this Space: set `CAMPUS_API_URL` to
`https://<owner>-<space>.hf.space` before building it.

## Notes

- Free Spaces sleep after inactivity; the first request after a sleep takes
  about half a minute while the container starts. The embedding model is baked
  into the image, so no download happens at start.
- Uploads are processed one at a time; a 78-page handbook takes about 20 s on
  the free CPU tier.
- PyMuPDF is AGPL-3.0 licensed; the source of this backend is public.
