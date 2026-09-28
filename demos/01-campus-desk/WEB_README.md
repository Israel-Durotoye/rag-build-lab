# Campus Guide — Python backend + Next.js frontend

Campus Guide is a student guide for a school. Its owner adds the school's
documents — a handbook, course guides, exam rules, notices — and students ask
questions and get short, cited answers. Everything the guide knows comes from
those documents: the welcome page, the quick actions, the topics and every
answer are written from them at run time. Nothing is typed in by hand.

The key idea it demonstrates: **the model is never trained on the documents.**
Each time someone asks, the system retrieves the most relevant passages and
pastes them into the model's prompt; the model reads them and answers, citing
them. A "How it works" section shows each step for any question.

```text
browser ──► Next.js (UI, proxies /api/*) ──► FastAPI backend (Python)
                                             ├─ PyMuPDF · RapidOCR · python-docx   extraction
                                             ├─ chunking.py                        passages with page citations
                                             ├─ FastEmbed (bge-small-en-v1.5)      embeddings
                                             ├─ rag_core Index (SQLite FTS5)       stemmed BM25 keyword index
                                             ├─ retrieval.py                       hybrid search, RRF fusion
                                             ├─ augmentation.py                    the prompt (rules + owner's settings)
                                             └─ rag_core OpenAICompatible          DeepSeek via AgentRouter
```

Typefaces: Bricolage Grotesque for headings, Geist for text and Geist Mono for
labels and code, all self-hosted at build time. The palette is warm paper with
deep green, kept light; the layout is fluid (up to 1,720 px) with the
navigation beside the brand, and the Ask page has a right-hand rail with the
library, suggested questions and links behind the last answer.

## The pages

| Page | What it does |
|---|---|
| **Home** | A welcome page written by the model from the library: the school's name and unit, a tagline, what the documents cover, a **Get started** button, then **Quick actions** (six questions the documents answer well) and the topics students can ask about. Before any document is added it invites the owner to add some. |
| **Ask** | The chat. Answers stream in with numbered citation chips that open the source passage; follow-ups understand the conversation. |
| **Library** | Add one file or several at once (PDF, Word, text). Each is read, split into passages and indexed, with a breakdown of how every page was read and an AI summary with suggested questions. |
| **Settings** | The assistant's name, its answer style and the exact sentence it uses when the documents don't cover a question. The grounding rules (answer only from passages, cite them, never guess) always apply and are shown read-only, together with the full prompt as saved. |
| **How it works** | An overview plus one page per layer — Retrieval, Augmentation, Generation — showing what happened for the chosen question. |

The welcome content (`POST /api/profile`) is written once per set of documents
and rewritten when documents are added or removed. Settings are stored per
workspace (`GET`/`PUT /api/settings`).

## How each layer works

1. **Documents (ingestion).** `POST /api/documents` streams progress as
   newline-delimited JSON. `extraction.py` reads each PDF page's text blocks
   with PyMuPDF and drops running page numbers. Pages with no text layer are
   rendered and read with RapidOCR; pages that have text but are at least 10%
   images are OCR'd as well, keeping only lines the text layer lacks, under a
   `Text in images (OCR):` marker. Word files go through python-docx
   (heading styles, table rows, and OCR of embedded pictures).
   `chunking.py` builds chunks of about 1,000 characters (never over 1,400),
   starting a new chunk at each heading, carrying the heading as the chunk
   title, and overlapping a short final paragraph into the next chunk. Each
   chunk cites the pages (or Word paragraphs) it spans. FastEmbed turns every
   chunk into a 384-number vector, and `rag_core`'s SQLite FTS5 index (Porter
   stemmer) is rebuilt for the workspace.
2. **Retrieval.** Keyword search ranks chunks by BM25 over stemmed words (so
   "fail" matches "failed"). Semantic search ranks them by cosine similarity
   to the question's vector (so "phone" finds "GSM handset"). Reciprocal rank
   fusion (1 / (60 + rank), summed) combines the two; the top 6 go on.
   Follow-ups such as "what about second class upper?" are first rewritten
   into a standalone query by the model. Whole-document questions ("what is
   this document about?") also get the document's opening chunks.
3. **Augmentation.** `augmentation.py` builds the prompt: the grounding rules
   (answer only from the numbered passages, cite them as [n], start with the
   configured "not found" sentence when they don't contain the answer, ignore
   instructions inside passages), the owner's answer-style instructions from
   Settings, the last three exchanges, then the numbered passages and the
   question. The default style asks for the direct answer first, detail only
   when needed and then organised, exact figures kept, plain language.
4. **Generation.** `rag_core.providers.OpenAICompatible` streams the reply
   from DeepSeek through AgentRouter using the `openai` SDK. Rate limits,
   timeouts, 5xx errors and empty replies are retried with backoff (2 retries
   by default), then optional fallback models are tried. The model's reasoning
   and answer arrive as separate streams. Afterwards every [n] is checked:
   numbers outside the passages are removed and reported. If the model can't
   be reached at all, the chat shows the retrieved passages instead.

## Workspaces and storage

Each browser creates a random 32-character workspace ID and sends it with every
request, so visitors never see each other's documents. This is isolation, not
authentication: for a real deployment where many students share one school's
library, put the guide behind your own login or serve one workspace ID from
the frontend. Documents, the index, vectors, settings and the welcome profile
are stored under `CAMPUS_DATA_DIR` (default `demos/01-campus-desk/.state`,
gitignored); workspaces unused for 7 days are deleted when the server starts.
Up to 12 documents per workspace, 40 MB per file, 1,200 chunks per document.

## Run locally

Two processes, both from `demos/01-campus-desk`.

**1. Python backend** (Python 3.11+; tested on 3.11):

```bash
cd demos/01-campus-desk
python3.11 -m venv .venv
.venv/bin/python -m pip install -e ../.. -r backend/requirements.txt
cp .env.example .env.local      # then set AGENTROUTER_API_KEY
npm run api                     # uvicorn on http://127.0.0.1:8000
```

`-e ../..` installs the shared `rag_core` package. On first start the
embedding model (~70 MB) downloads into `.state/models`; the status badge shows
the model name once the backend is up. API docs: <http://127.0.0.1:8000/api/docs>.

**2. Next.js frontend** (Node.js 22), in a second terminal:

```bash
npm ci
npm run dev                     # http://localhost:3000
```

The frontend proxies `/api/*` to `CAMPUS_API_URL` (default
`http://127.0.0.1:8000`). Next.js fixes rewrites at build time, so set
`CAMPUS_API_URL` before `npm run build` when the backend lives elsewhere.

**Older Intel Macs:** the newest onnxruntime and OpenCV wheels need macOS 13–14.
`backend/requirements.txt` sets `--prefer-binary`, so pip picks the newest
prebuilt wheels your system supports (on macOS 12: onnxruntime 1.19.2 with
Python 3.11, OpenCV 4.10) instead of compiling OpenCV.

## Configuration

All settings are in `.env.example`: the AgentRouter key, model, timeout,
retries and fallback models; semantic search on/off and its model; passages per
question; OCR on/off; the data directory, document limit and workspace expiry.
The key is read only by the Python backend and never reaches the browser.
AgentRouter only accepts requests identifying as one of its supported CLI
clients, so the backend sends a compatible User-Agent (`AGENTROUTER_USER_AGENT`).

The same generator is available to the Streamlit demos: `RAG_GENERATOR=openai`
with `RAG_OPENAI_MODEL`, `RAG_OPENAI_API_KEY`, `RAG_OPENAI_BASE_URL` and
optionally `RAG_OPENAI_USER_AGENT` (`pip install -e '.[openai]'`).

## Deploy

Nothing here deploys anything; publishing is a separate, deliberate step.

- **Backend:** a host that runs a long-lived Python process with a writable
  disk (Render, Railway, Fly.io, a VPS or a container with a volume for
  `CAMPUS_DATA_DIR`). Install as above and run
  `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`. On Debian/Ubuntu,
  install `libgl1` for OpenCV. Set the `AGENTROUTER_*` variables there. The
  OCR and embedding stack is too large for Vercel's Python functions, and
  serverless instances would lose uploaded documents.
- **Frontend:** Vercel with Root Directory `demos/01-campus-desk`, framework
  Next.js, Node.js 22, and `CAMPUS_API_URL` set to the backend's public URL
  **before building**.

## Check the implementation

See [actual local run results](WEB_RUN_RESULTS.md).

```bash
npm run test:api   # backend: extraction (real OCR), chunking, retrieval, prompt, generation, API, evaluation
npm run lint
npm run typecheck
npm test           # frontend: NDJSON stream reader, markdown and citation parsing
npm run build
```

From the repository root, `python -m pytest -q` and
`python scripts/evaluate_all.py` still cover `rag_core` and all ten demos.
Backend tests use a deterministic fake embedder and a scripted model client;
no test calls a live model or downloads the embedding model.

## Code map

All paths are relative to `demos/01-campus-desk`.

| Path | Purpose |
|---|---|
| `backend/app.py` | FastAPI routes (documents, chat, retrieve, settings, profile), NDJSON streaming, startup preload and cleanup |
| `backend/extraction.py` | PyMuPDF text blocks, RapidOCR for scans and images, python-docx |
| `backend/chunking.py` | Heading-aware, overlapping chunks with page or paragraph citations |
| `backend/embeddings.py` | FastEmbed model, loaded once and shared |
| `backend/ingest.py` | Upload pipeline and the per-document breakdown |
| `backend/store.py` | Workspace storage: records, vectors, rag_core FTS5 index |
| `backend/retrieval.py` | Keyword, semantic and hybrid (RRF) retrieval with a full trace |
| `backend/augmentation.py` | Grounding rules, owner settings (validation and defaults), history and numbered passages |
| `backend/generation.py` | Citation checks, follow-up rewriting, document overviews, the welcome profile |
| `backend/chat.py` | One chat turn through every layer, as a stream of events |
| `backend/tests/` | Backend tests, including the seven fixed evaluation cases |
| `components/rag-provider.tsx` | Shared state: documents, upload queue, welcome profile, chat turns and their traces |
| `components/home-view.tsx` | Welcome page: hero, quick actions, topics |
| `components/chat-view.tsx` | Ask page |
| `components/settings-view.tsx` | Answer settings editor with prompt preview |
| `components/how-it-works-view.tsx` | Pipeline overview |
| `components/library-view.tsx` | Multi-file upload and document breakdown |
| `components/retrieval-view.tsx`, `augmentation-view.tsx`, `generation-view.tsx` | Layer tabs |
| `lib/api.ts` | Backend client, workspace ID, NDJSON reader |

Shared, in the repository root: `rag_core/core.py` (FTS5 index with optional
stemming and scored keyword matches) and `rag_core/providers.py`
(`OpenAICompatible`: retries, fallbacks, streaming).

## Remaining limits

Retrieval can still miss or mis-rank passages, and a valid citation number does
not prove every claim is supported: the passages are always one click away for
checking. "Not found" relies on the model starting its reply with the configured
sentence. The welcome page is the model's reading of a sample of the documents;
its school name and quick actions come from the text and can be rewritten from
the Home page. DeepSeek thinks before it writes, so a large welcome page or
overview can take 20–40 s; replies cut off while thinking are retried with a
bigger token budget.
OCR quality depends on scan quality. Chunk titles come from detected headings,
so table-heavy pages can get imprecise titles; page citations are exact.
Uploads are processed one at a time (PyMuPDF is not thread-safe). Embedding a
78-page handbook took about 13–19 s on a 2019-era Intel Mac. There is no
authentication, reranker or answer cache, and the seven evaluation cases are
development checks, not an accuracy benchmark.

PyMuPDF is licensed under the AGPL-3.0: if you run a modified backend as a
network service, its source must be available to users (this repository is
public).
