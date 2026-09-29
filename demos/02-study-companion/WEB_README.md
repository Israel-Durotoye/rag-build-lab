# Study Companion — Python backend + Next.js frontend

Study Companion is for a student trying to understand a particular set of
notes. They add their lecture notes or a chapter, ask what they don't follow,
and get three things back: an explanation, the exact sections behind it, and
the original text. They can also test themselves with quizzes and flashcards
written from the same notes.

The idea this site demonstrates is **chunking**. Before notes can be searched
they are cut into chunks, and how they are cut decides what the model gets to
read. Every set of notes is chunked two ways, side by side:

- **Section-aware**: one chunk for each section (a heading and the text under it).
- **Fixed-length**: windows of a set number of words, which can begin or end
  in the middle of a thought.

A small match can then **grow to its whole parent section**, as long as the
context stays inside a word budget. The Compare page runs one question against
both chunkings and shows what each one found. It reports differences and never
declares a winner.

```text
browser ──► Next.js (UI, proxies /api/*) ──► FastAPI backend (Python)
                                             ├─ rag_core.web.extraction · ocr     PDF, Word, text (shared with Campus Guide)
                                             ├─ sectioning.py                     headings → sections of at most 220 words
                                             ├─ rag_core chunk_document           section chunks and fixed windows
                                             ├─ rag_core.web.embeddings           FastEmbed (bge-small-en-v1.5)
                                             ├─ rag_core Index (SQLite FTS5) × 2  one stemmed BM25 index per chunking
                                             ├─ rag_core.web.retrieval            hybrid search, RRF fusion
                                             ├─ rag_core.study build_context      parent-section expansion, word budget
                                             ├─ context.py · prompting.py         caveats, the prompt
                                             ├─ practice.py                       quizzes, flashcards, quote checks
                                             └─ rag_core OpenAICompatible         any OpenAI-compatible chat API
```

The frontend and backend share API contract version `1`. FastAPI returns it in
the `/api/status` body and the `X-Study-API-Version` header on every response;
the Next.js client rejects an older or newer backend with an explicit
deployment error. When the contract changes, update both constants and deploy
both halves.

Typefaces: Fraunces for headings, Instrument Sans for text and JetBrains Mono
for labels, all self-hosted at build time. The palette is notebook paper with
indigo ink and a yellow highlighter, which marks the notes' own words wherever
they are quoted.

## The pages

| Page | What it does |
|---|---|
| **Home** | Before any notes: what the site does, with **Try the sample notes** and an upload box. Afterwards: questions your notes can answer, and each set of notes with its summary and key terms. |
| **Ask** | The conversation. Each reply has the explanation (streamed, with numbered citations), a **Watch for** box quoting the notes' own caveats, and the supporting sections. A section opens to show what the model read; a fragment can show the whole section it was cut from, with the fragment highlighted. Choose the chunking, the search mode and whether small matches expand. |
| **Compare** | The chunking lab. One question against both chunkings: what each retrieved, what reached the context, what the budget left out, and which sections only one of them reached. Below it, run a set of questions (the sample notes' eight, or your own). No model is used here. |
| **Practise** | Quizzes and flashcards written by the model from up to eight sections, and recall cards that need no model. Every item names its section and offers a quote, which is checked against the notes. Sets are saved. |
| **Notes** | Add files (PDF, Word, text, Markdown), several at once. Each set of notes shows what happened to it (reading, sections, both chunkings, index) and the notes themselves, as sections or with every fixed-length window shaded. |
| **How it works** | An overview, then one page per step — Retrieval, Context, Generation — showing what happened for the chosen question, including the exact prompt. |
| **Settings** | The explanation level (Simple, Standard, Exam revision), extra instructions, the "not found" sentence, and the four numbers that shape the context. The grounding rules are shown but cannot be changed. |

## How each layer works

1. **Reading the file.** `POST /api/documents` streams progress as
   newline-delimited JSON. Extraction is the code Campus Guide uses, now in
   `rag_core/web`: PyMuPDF reads each page's text blocks, RapidOCR reads scans
   and text inside images, python-docx reads Word files.
2. **Finding the sections.** `sectioning.py` starts a section at each heading.
   A heading directly above another names the section too ("Chapter 2 ·
   Negative feedback"). A heading with more than 220 words under it is split
   between paragraphs into parts ("Integral action (part 2 of 3)"), so a
   parent section always fits a reasonable context. Text before the first
   heading takes the file's name.
3. **Chunking, both ways.** `rag_core.chunk_document` makes one chunk per
   section, and fixed windows of `chunkWords` words (50 by default). Windows
   never cross a heading. A section's last window joins the one before it when
   it would hold fewer than a quarter of the chunk size, so no chunk is a
   word or two long. Both sets are embedded and indexed, in
   `index-section.sqlite` and `index-fixed.sqlite`.
4. **Retrieval.** Keyword search ranks chunks by BM25 over stemmed words.
   Semantic search ranks them by cosine similarity to the question's vector.
   Reciprocal rank fusion (1 / (60 + rank), summed) combines the two, and the
   top `k` (5 by default) go on. When no chunk contains any word of the
   question, the result is flagged: semantic search always returns its
   nearest chunks, related or not.
5. **Context.** `rag_core.study.build_context` takes the matches in rank
   order. A match under `expandBelowWords` (60) that is only part of its
   section is replaced by the whole section, if the total stays within
   `budgetWords` (600). What does not fit is left out and listed. The top
   match is always kept. `context.py` then picks out the notes' caveats:
   sentences in the context that contain a qualifier ("not", "unless",
   "except", "only if", "never"…) and share words with the question. They are
   chosen by rule, not by a model, and shown beside every answer.
6. **The prompt.** `prompting.py` writes the rules (use only the numbered
   sections, cite them, **keep every exception and condition**, start with the
   "not found" sentence when the sections don't hold the answer, ignore
   instructions inside the notes), the student's chosen style, the numbered
   sections and the question.
7. **Generation.** `rag_core.providers.OpenAICompatible` streams the reply,
   with retries and optional fallback models. Afterwards every `[n]` is
   checked: numbers that don't match a section in the prompt are removed and
   reported. Without a model, or when it cannot be reached, up to four
   sentences are copied from the context instead and labelled as not
   generated. When nothing in the notes matches, no model is asked at all.

### Follow-ups

A follow-up such as "What about windup?" is searched with the topic in mind.
Only the student's earlier **questions** are carried over: they go to the
model that rewrites the query, and into the prompt marked "for reference only,
not evidence". Earlier **answers** are never sent anywhere, so a generated
answer cannot become evidence for the next one. Without a model, the topic's
first question is joined to the follow-up (`topic\nFollow-up: question`), as
the command-line demo does.

Whether a message is a follow-up is decided by how it starts and how short it
is. That guess is shown with each reply, with **Ask it as a new topic** beside
it, and **New topic** above the question box ends a topic before asking.

### Practice

`POST /api/practice` chooses up to eight sections (the nearest to the focus,
or an even spread across the notes), asks the model for JSON, and checks every
item before saving:

- an item that names a section it was not given, or a quiz item without four
  distinct options and a valid answer, is **dropped**;
- the quote each item offers as proof must appear in its section word for word
  (ignoring case, spacing and punctuation). If it does not, the item is kept
  but **flagged**, and the interface says so;
- quiz options are shuffled, because models favour one position for the right
  answer.

Recall cards use a section's heading as the prompt and the notes' own text as
the answer, so they work without a model.

## Workspaces and storage

Each browser creates a random 32-character workspace ID and sends it with every
request, so visitors never see each other's notes. This is isolation, not
authentication. Notes, both indexes, vectors, settings and practice sets are
stored under `STUDY_DATA_DIR` (default `demos/02-study-companion/.state`,
gitignored); workspaces unused for 7 days are deleted when the server starts.
Up to 12 sets of notes per workspace, 40 MB per file, 1,200 sections per file.

Each workspace records the rules its fixed chunking was built with. If they
differ from the current ones (a new chunk size whose re-chunking was cut
short, or a newer version of the backend), the notes are re-chunked the next
time the workspace is opened.

## Run locally

Two processes, both from `demos/02-study-companion`.

**1. Python backend** (Python 3.11+; tested on 3.11):

```bash
cd demos/02-study-companion
python3.11 -m venv .venv
.venv/bin/python -m pip install -e ../.. -r backend/requirements.txt
cp .env.example .env.local      # then set STUDY_MODEL_API_KEY
npm run api                     # uvicorn on http://127.0.0.1:8001
```

`-e ../..` installs the shared `rag_core` package. On first start the
embedding model (~70 MB) downloads into `.state/models`. API docs:
<http://127.0.0.1:8001/api/docs>. If Campus Guide is already set up, its
`.env.local` works here unchanged (`cp ../01-campus-desk/.env.local .`), and
copying its `.state/models` folder saves the download.

**2. Next.js frontend** (Node.js 22), in a second terminal:

```bash
npm ci
npm run dev                     # http://localhost:3001
```

The ports differ from Campus Guide's (8000 and 3000), so both sites can run at
once. The frontend proxies `/api/*` to `STUDY_API_URL` (default
`http://127.0.0.1:8001`). Next.js fixes rewrites at build time, so set
`STUDY_API_URL` before `npm run build` when the backend lives elsewhere.

`next dev` writes an `AGENTS.md` and a `CLAUDE.md` into this folder (a notice
for coding assistants about this version of Next.js). They are not part of
the app; keep or delete them as you prefer.

## Configuration

All settings are in `.env.example`. The key is read only by the Python backend
and never reaches the browser. Any OpenAI-compatible endpoint works: set
`STUDY_MODEL_BASE_URL`, `STUDY_MODEL` and `STUDY_MODEL_API_KEY`.

What a student can change is on the Settings page and stored per workspace:

| Setting | Default | Range | Effect |
|---|---|---|---|
| Explanation level | Standard | Simple · Standard · Exam revision | The style part of the prompt; also the difficulty of quizzes |
| Matches per question (`k`) | 5 | 1–10 | Chunks retrieval hands on |
| Context word budget | 600 | 100–2000 | The most words the context may hold |
| Expand matches below | 60 | 10–300 | Smaller partial matches grow to their section |
| Fixed chunk size | 50 | 20–200 | Words per fixed window; changing it re-chunks the notes |

The command-line demo keeps its own values in `config.json` (4, 250, 60, 40).

## Deploy

Nothing here deploys anything; publishing is a separate, deliberate step. The
steps are the ones Campus Guide uses.

### Backend on a Hugging Face Space (Gradio + ZeroGPU)

```bash
./hf-space/deploy-space.sh <owner>/study-companion-api --dry-run   # assemble only
./hf-space/deploy-space.sh <owner>/study-companion-api --public    # create or update the Space
```

The script assembles `rag_core/`, `backend/` without its tests, the sample
notes and the packaging files, refuses to upload if a secret-looking value is
among them, and uploads with the `hf` CLI. Then add the secret
`STUDY_MODEL_API_KEY` on the Space. The Space must be public for a Vercel
frontend to reach it. From a Space, use a model provider that accepts
datacenter traffic (see `hf-space/README.md`); AgentRouter does not. Uploaded
notes use ephemeral storage and disappear when the Space restarts.

On the Space, Gradio owns the homepage, so the FastAPI routes are registered
under `/study-api/*` and a middleware maps the public `/api/*` paths onto
them.

### Frontend on Vercel

Root Directory `demos/02-study-companion`, framework Next.js, Node.js 22, and
`STUDY_API_URL` set to the Space URL **before building**. The browser only
talks to the Vercel domain; Next.js proxies `/api/*` to the Space, so no CORS
setup is needed.

### Check a deployment

```bash
./check-deploy.sh https://your-app.vercel.app          # status, contract header, workspace routes, API docs
./check-deploy.sh https://your-app.vercel.app --full   # also upload notes, ask, compare, make recall cards, delete
```

It works against a local site too (`./check-deploy.sh http://127.0.0.1:3001 --full`).

## Check the implementation

See [actual local run results](WEB_RUN_RESULTS.md).

```bash
npm run test:api   # backend: sectioning, uploads, ask, follow-ups, context, compare, practice, API
npm run lint
npm run typecheck
npm test           # frontend: NDJSON reader, contract, markdown, fixed windows, highlighting, scoring
npm run build
```

From the repository root, `python -m pytest -q` and
`python scripts/evaluate_all.py` still cover `rag_core` and all ten demos.
Backend tests use a deterministic fake embedder and a scripted model client;
no test calls a live model or downloads the embedding model.

## Code map

All paths are relative to `demos/02-study-companion`.

| Path | Purpose |
|---|---|
| `backend/app.py` | FastAPI routes, NDJSON streaming, the workspace dependency that re-chunks stale notes |
| `backend/sectioning.py` | Headings into sections of at most 220 words |
| `backend/store.py` | Workspace storage: records, one index and one set of vectors per chunking, settings, practice sets |
| `backend/ingest.py` | Upload pipeline; the sample notes |
| `backend/context.py` | Parent expansion and budget (via `rag_core.study`), caveats, verbatim sentences |
| `backend/prompting.py` | Grounding rules, style, the prompt and its trace |
| `backend/turn.py` | One question through every layer, as a stream of events; follow-ups |
| `backend/compare.py` | The same question against both chunkings |
| `backend/practice.py` | Section selection, prompts, item checks, quote verification |
| `backend/overview.py` | Summary, key terms and questions for one set of notes |
| `backend/preferences.py` | The student's settings: defaults, ranges, validation |
| `backend/settings.py` | Server configuration from the environment |
| `backend/tests/` | Backend tests |
| `components/study-provider.tsx` | Shared state: notes, uploads, settings, the conversation and its topic, the lab |
| `components/ask-view.tsx` | Ask page |
| `components/compare-view.tsx` | Chunking lab and question sets |
| `components/practice-view.tsx` | Quiz, flashcards, saved sets |
| `components/notes-view.tsx` | Uploads, what happened to a file, the reader with shaded windows |
| `components/how-it-works-view.tsx`, `retrieval-view.tsx`, `context-view.tsx`, `generation-view.tsx` | The pipeline pages |
| `components/settings-view.tsx` | Settings with the prompt as saved |
| `components/ui.tsx` | Source cards, budget meter, caveats, upload panel |
| `lib/api.ts`, `lib/contract.ts`, `lib/types.ts` | Backend client, contract version, payload types |
| `lib/text.ts`, `lib/practice.ts` | Fixed windows, fragment highlighting, scoring |
| `check-deploy.sh` | Checks a deployed frontend or backend against this contract |
| `hf-space/` | Hugging Face Space entrypoint, card, packages and deploy script |

Shared, in the repository root: `rag_core/web/` (extraction, OCR, embeddings,
hybrid retrieval, citation checks, NDJSON helpers and test doubles, used by
both websites), `rag_core/study.py` (parent expansion, verbatim sentences),
`rag_core/core.py` (chunking, FTS5 index) and `rag_core/providers.py`.

## Remaining limits

- A valid citation number shows the section was in the prompt. It does not
  prove every claim in the sentence is supported, so sections are always one
  click away. The same holds for a verified quote on a practice item: the
  quote is in the notes, but whether the item's answer follows from it is for
  the student to judge.
- The caveats are picked by word rules. They can include a sentence that is
  beside the point, and they miss a caveat phrased without one of the
  qualifier words.
- "Not found" relies on the model starting its reply with the configured
  sentence. Keyword search abstains only when no word matches; semantic search
  never abstains, which is why matches by meaning alone are flagged.
- Follow-up detection is a guess from the message's first words and length.
- Sections come from detected headings. Notes without headings become parts of
  one long section, and a table-heavy page can get an imprecise title. OCR
  reads printed text; handwriting is not supported.
- The comparison shows what each chunking retrieved for the questions asked,
  over the notes loaded, with the settings chosen. It is not a benchmark.
- There is no authentication, reranker or answer cache. Practice sets are not
  regenerated when notes change. Uploads are processed one at a time.

PyMuPDF is licensed under the AGPL-3.0: if you run a modified backend as a
network service, its source must be available to users (this repository is
public).
