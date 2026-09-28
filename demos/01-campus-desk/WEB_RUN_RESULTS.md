# TypeScript web verification — 27 September 2026 (upload-first rework)

The app was reworked into an upload-first RAG demo: the visitor adds a PDF or
Word document in the browser (pdf.js text layer + tesseract.js OCR for scanned
pages, mammoth for .docx), the server retrieves per request with BM25, and
DeepSeek via AgentRouter writes cited answers when a key is configured. There
is no bundled default corpus in the web app; `corpus.json` remains as the
shared test/evaluation fixture. No deployment has been created.

## Tested versions

Node.js 22.17.0, Next.js 16.3.6, React 19.3.0, TypeScript 6.0.3,
pdfjs-dist 6.2.108, tesseract.js 6.0.1, mammoth 1.13.0, lucide-react 1.48.0.
Exact dependencies are recorded in this folder's package files.

## Actual checks

Commands ran inside this demo directory:

| Command | Result |
|---|---|
| `npm run lint` | Passed, no errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | 36 passed, 0 failed, 0 skipped |
| `npm run evaluate` | 7/7 fixed retrieval/status checks over the fixture corpus |
| `npm run build` | Production build passed; routes: `/`, `/api/search` |

Repository-root Python checks after the rework: `python -m pytest -q`
**61 passed**; `python scripts/evaluate_all.py` **27/27** across ten demos.

The TypeScript tests cover section metadata and hashes, revision changes,
duplicate IDs, tenant-document rejection (validator, ingestion and API),
page-based sectioning and chunk limits, knowledge-base size budgets, invalid
request bodies and sizes, request isolation, citation validation, model
abstention/failure, and the AgentRouter provider contract with mocked fetch.

## Browser checks (production server, headless Chrome)

- **Text-layer PDF** (generated staff manual): chip showed
  `PDF · 1 page · 1 section`; live DeepSeek answer "Full-time staff members
  earn 21 days of annual leave." cited `p. 1`, passage marked *cited*.
- **Image-only PDF** (no text layer): OCR path ran with CDN assets; chip
  showed `1 read with OCR`; live answer "Lights out is at 11:00 pm every
  night." with a correct citation.
- **Real handbook** (`DOME_100_300HB-1.pdf`, 78 pages, has a text layer):
  processed in **0.7 s** into 62 sections. "What CGPA do I need for a First
  Class?" → "You need a CGPA of 4.5–5.0 for a First Class." cited p. 57–58.
  "How many weeks is SIWES II?" → "SIWES II is 24 weeks." cited p. 71 and
  p. 55; both cited passages contain the 24-week statement.
- **How this answer was made** disclosure showed the Index → Retrieve →
  Generate steps with live numbers (62 sections, top 4 passages, 3,787 ms).
- **Mobile 390 × 844**: welcome and loaded states rendered with zero
  horizontal overflow; desktop 1440 likewise.
- No page errors or console errors in any run.

Live generation used `deepseek-v4-flash` via AgentRouter with the key in
`.env.local` (gitignored, never committed). Without a key the same flows fall
back to source-search mode, which the tests exercise.

## Limitations

OCR loads English only and its quality depends on scan quality; the pdf.js
worker and tesseract assets come from version-pinned jsDelivr CDNs, so OCR
needs internet. Large files are trimmed to the shared limits (200 sections,
~860k characters, 120 OCR pages) with a visible notice. BM25 keyword matching
can miss paraphrases; valid citation IDs do not guarantee factual support, so
passages are always shown. AgentRouter accepts only requests identifying as
its supported CLI clients; the server sends a compatible User-Agent. The seven
evaluation cases are fixed development checks, not an accuracy benchmark.

## Expanded workspace interface — September 27, 2026

Replaced the single-column interface with a dark three-column workspace,
responsive navigation, document section filtering, session question history,
source previews with copy citations, and a document-to-answer workflow guide.
The upload, extraction, API and provider implementations were preserved.

Checks after the redesign: lint and TypeScript passed; all **36** web tests and
**7/7** retrieval cases passed; the Next.js production build passed. The release
checks also passed: **61** Python tests and **27/27** cross-demo retrieval cases.
The mock HTTP provider test required local socket permission outside the sandbox.

Chrome verification used a synthetic three-section Markdown document through the
real file input, extraction, local storage, search API and answer UI. The
configured DeepSeek provider answered the library-hours question with **20:00**
and cited the matching section. Verified full source previews, citation copying,
section filtering by a body-text phrase, restoring a recent answer without a new
request, the workflow guide, and document removal clearing the document and
session history. No browser errors or framework error overlays were observed.

Inspected screenshots at 1440×1100 and 390×844, including mobile library and source
preview states. Document width matched both 390px and 320px mobile viewports. Screenshots
are local, ignored artifacts under `reports/campus-workspace-*.png`.
The Vercel install audit identified GHSA-hq66-cqwq-w95j in the prior PDF reader.
Upgraded `pdfjs-dist` to the patched 6.2.108 release and migrated PDF cleanup to
`PDFDocumentLoadingTask.destroy()`. Rechecked a synthetic text-layer PDF and an
image-only PDF in Chrome: each produced one searchable page; the scan recorded
`ocrPages: 1`, `ocrFailed: false`. Re-ran lint, type checking, all 36 tests and the
production build successfully. The package install audit reported zero known
vulnerabilities. Word extraction was unchanged; its prior checks remain above.
The TypeScript config excludes ignored `reports/` artifacts from compilation.

Upstream advisory: https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j

Final production deployment: `dpl_3WN3gvpboDmT3An7HT5kd1b7ateJ`, READY at
https://campus-desk-chi.vercel.app. Vercel's final build succeeded and its install
audit reported zero known vulnerabilities. The public homepage, synthetic
library search, and no-evidence response passed smoke checks. Production remains
in source-search mode; the locally configured model key was not uploaded.
This deployment uses the verified working copy; no Git commit or push was made
as part of this interface update.

## Python backend — September 28, 2026

The whole backend moved to Python. A FastAPI app in `backend/` now does file
upload and extraction (PyMuPDF text layer, RapidOCR for scanned pages and text
inside images, python-docx for Word including embedded pictures), retrieval
through `rag_core.Pipeline` (in-memory SQLite FTS5 / BM25, citation
validation), and generation with DeepSeek via AgentRouter through the `openai`
SDK (`rag_core.providers.OpenAICompatible`). Next.js keeps Codex's workspace
interface and proxies `/api/*` to the backend. The TypeScript retrieval,
extraction, provider and API route code, the `npm run evaluate` script, and the
pdfjs-dist / tesseract.js / mammoth dependencies were removed.

Backend environment: Python 3.11.2 on macOS 12.7.6 (Intel), FastAPI 0.141.1,
Uvicorn 0.54.0, PyMuPDF 1.28.2, RapidOCR 3.9.2, onnxruntime 1.19.2,
opencv-python 4.10.0.84, python-docx 1.2.0, openai 3.19.2, python-dotenv 1.2.3.
Newer onnxruntime/OpenCV wheels require macOS 13–14; `--prefer-binary` in
`backend/requirements.txt` made pip select these prebuilt wheels.

| Command | Result |
|---|---|
| `npm run test:api` (backend pytest) | 60 passed |
| `npm run lint` | Passed, no errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | 7 passed, 0 failed |
| `npm run build` | Passed; no Next.js API routes remain |
| `python -m pytest -q` (repository root) | 64 passed (3 new `rag_core` tests) |
| `python scripts/evaluate_all.py` | 27/27 across ten demos |

The backend tests use real PyMuPDF, python-docx and RapidOCR on generated
fixtures (a text PDF, an image-only PDF, a text page containing an image with
extra text, a password-protected PDF, and Word files with headings, a table and
a picture), and run the seven fixed evaluation cases through `/api/search`
(7/7). The model is mocked in tests.

Live checks with both servers running (backend on :8000, production frontend
on :3100, Chrome via puppeteer):

- `DOME_100_300HB-1.pdf` (78 pages, text layer on every page): extracted in
  8.3–9.1 s including OCR model load, into 69 sections (111,378 characters).
  Pages 1, 2 and 78 are mostly images and were OCR'd; text found only in the
  cover images was added to 2 pages. Progress events streamed through the
  Next.js proxy one by one (text 1–78 in ~1.5 s, then OCR 1–3, then sections).
- DeepSeek (`deepseek-v4-flash`) answers through the full stack: First Class →
  "4.5–5.0" cited p. 57; SIWES II → "24 weeks" cited p. 71 and p. 55; "What is
  written on the handbook cover?" answered from OCR text only (and noted the
  scan's "HANBOOK" spelling); hostel fees → insufficient evidence with no
  model call.
- A Word file whose only mention of the fire assembly point is inside a
  picture: the answer "front lawn beside the flagpole" came from OCR.
- With the backend stopped, the page shows "Backend offline" and a notice.
- Mobile 390 px: zero horizontal overflow. No page or console errors.

Not verified here: GitHub Actions runs (including the new `api` job with
`libgl1` on Ubuntu) and any hosted deployment. The existing Vercel deployment
predates this change; a new frontend build needs `CAMPUS_API_URL` pointing at a
hosted Python backend.

## Chat, layer tabs and a stronger pipeline — September 28, 2026

**Why answers were missing.** The model itself was answering: 8 of 8 direct
handbook questions produced cited answers through the previous backend
(1.7–5.9 s). The failures came from retrieval and the lack of conversation
memory. Exact-word keyword search found **no passages** for "can I bring my
phone to the exam?" (the handbook says "GSM handset" and "examination"),
ranked the wrong passages for "what if I fail a course?" and "What courses do
300 level students take?" (the model then correctly reported insufficient
evidence), and could not handle "hi", "Explain it simply" or "What about
second class upper?".

**What changed.** Documents are now stored per browser workspace on the server,
chunked (~1,000 characters, heading-aware, overlapping, page-cited), embedded
with FastEmbed (BAAI/bge-small-en-v1.5, 384 dimensions) and indexed with a
Porter-stemmed SQLite FTS5 index. Retrieval is hybrid (BM25 + cosine
similarity, fused with RRF), follow-ups are rewritten by the model before
searching, and whole-document questions include the opening chunks. Generation
streams from DeepSeek with retries, optional fallback models, separate
reasoning and answer streams, a fixed "not found" sentence, citation checks,
and a passages-only fallback if the model is unreachable. The interface is now
a chat page plus Documents, Retrieval, Augmentation and Generation tabs.

Before choosing the embedding model, three FastEmbed models were compared on
five hard handbook questions (right page in the top 6): bge-small-en-v1.5 5/5
(17.4 s to embed 147 chunks on this Mac), all-MiniLM-L6-v2 4/5 (5.0 s),
snowflake-arctic-embed-xs 2/5 (7.4 s).

| Check | Result |
|---|---|
| `npm run test:api` (backend pytest) | 95 passed |
| `npm run lint` / `npm run typecheck` | Passed, no warnings |
| `npm test` | 7 passed |
| `npm run build` | Passed; routes `/`, `/documents`, `/retrieval`, `/augmentation`, `/generation` |
| `python -m pytest -q` (repository root) | 69 passed (6 new `rag_core` tests) |
| `python scripts/evaluate_all.py` | 27/27 across ten demos |

The backend evaluation now checks the two "no evidence" questions differently:
stemming lets "fees" match the handbook's "fee", so keyword search returns
fee-related passages for "What are the hostel accommodation fees?". The test
asserts that no retrieved passage mentions the question's subject; saying
"not in the document" is the generation layer's job, verified live below.

New versions: fastembed 0.8.1, numpy 2.4.6 (other backend versions as above).

**Live run** (real embeddings and DeepSeek `deepseek-v4-flash`, backend on
:8100, production frontend on :3100, headless Chrome):

- Upload of `DOME_100_300HB-1.pdf`: 19.7–22.9 s end to end (extract with OCR
  6.7–7.7 s, embed 137 chunks 12.9–14.9 s, index ≈ 35 ms); 137 chunks, sizes
  294–1,393 characters, 2,824 distinct terms, 2 pages with text read from
  images. The overview (summary, topics, four questions) was written after
  upload.
- The questions that failed before:

| Question | Before | Now |
|---|---|---|
| can I bring my phone to the exam? | no passages | "No — … GSM handset … punishable by expulsion", cited p. 69–70 |
| what if I fail a course? | model: insufficient evidence | repeat-course rules, cited p. 58–60 |
| What courses do 300 level students take? | model: insufficient evidence | first- and second-semester course lists, cited p. 17–19 |
| hi | no passages | short greeting describing what it can do (uncited) |
| What is this document about? | answered from an exam-rules passage | "the Students' Handbook (2021–2025) of the Department of Mechatronics Engineering … FUT Minna", cited p. 1–3 |
| What about second class upper? (after the First Class question) | needed a previous question | rewritten to "CGPA required for Second Class Upper" → "3.5–4.49", cited p. 57 |
| Explain it simply (next) | no passages | plain-language explanation of CGPA, cited |
| What are the hostel accommodation fees? | no passages | "I couldn't find this in the document." (status: not found) |

  First answer words arrived 1.8–5.5 s after the question (DeepSeek reasons
  first); total turn times 1.6–6.5 s.
- Every tab rendered the trace for the chosen question; follow-up rewriting,
  keyword/semantic/fused rankings, the prompt, attempts, reasoning, raw output
  and the citation check all matched the chat. No page or console errors.
- Width: 0 px horizontal overflow at 390 px on chat, documents and retrieval;
  desktop pages at 1440 px. An overflow of 1,136 px on the documents page
  (caused by a long joined chunk title) was found and fixed during this run.

Not verified: GitHub Actions, any hosted deployment, and behaviour under many
simultaneous users.

## Campus Guide — September 28, 2026

Renamed the product to **Campus Guide** (the folder stays `demos/01-campus-desk`)
and rebuilt the interface as a light theme with purple outlines and five pages:
Home, Ask, Library, How it works (with the Retrieval, Augmentation and
Generation pages under it) and Settings. Everything shown about the school is
written by the model from the uploaded documents: `POST /api/profile` produces
the school and unit names, tagline, welcome text, topics and six quick actions,
cached per set of documents. Several files can be added at once (queued, with
per-file progress). Answer instructions are editable in Settings
(`GET`/`PUT /api/settings`): assistant name, answer style and the "not found"
sentence; the grounding rules are fixed and shown read-only with the full
prompt. Defaults ask for the direct answer first and organised detail only when
needed.

Found during this run: DeepSeek reasons for up to ~6,000 tokens before writing
the welcome-page JSON, so a 2,400-token budget returned empty replies. Replies
cut off while thinking are now retried with a doubled budget (up to 16,000),
and the profile writer falls back to a smaller document sample if the model
still fails. Long ALL-CAPS names from documents are title-cased in the
interface.

| Command | Result |
|---|---|
| `npm run test:api` (backend pytest) | 99 passed |
| `npm run lint` / `npm run typecheck` | Passed, no warnings |
| `npm test` | 8 passed |
| `npm run build` | Passed; routes `/`, `/ask`, `/library`, `/settings`, `/how-it-works`, `/retrieval`, `/augmentation`, `/generation` |
| `python -m pytest -q` (repository root) | 85 passed |

**Live run** (real embeddings and `deepseek-v4-flash`, backend on :8100,
production frontend on :3100, headless Chrome, fresh workspace):

- Two files added in one action from the Home page (the 78-page handbook and a
  one-page staff manual): both uploaded in 30 s with per-file progress.
- The welcome page was written in about 14 s: "Welcome to Federal University of
  Technology, Minna", unit "School of Electrical Engineering and Technology,
  Department of Mechatronics Engineering", tagline "Navigate Mechatronics
  Engineering admission, courses, structure, and graduation requirements.",
  eight topics and six quick actions (e.g. "Find areas of specialization",
  "See head of department").
- A quick action opened Ask and answered with citations (eleven areas of
  specialization, cited p. 8–9 and p. 3). "What are the hostel accommodation
  fees?" returned the configured not-found sentence.
- Settings: a changed answer style appeared in the saved prompt while the
  grounding rules stayed in place.
- 0 px horizontal overflow at 390 px on Home, Ask, Library and Settings;
  no page or console errors.
- One earlier run's welcome page failed with a model error before the budget
  fix; the same request succeeded when repeated.

Not verified: GitHub Actions and any hosted deployment.

### Visual refresh — September 28, 2026

Typography changed to Fraunces (headings, self-hosted through next/font) with
Manrope for text; the hero's illustration was replaced by an "In the library"
panel built from the real document list and counts; quick actions became
numbered cards; the three steps are a connected strip; replies carry a "CG"
mark; buttons and the composer are pill-shaped with purple gradients. A missing
`--display` token (headings had fallen back to the sans face) was caught by a
computed-style check in headless Chrome and fixed. Lint, TypeScript, 8 web
tests and the production build pass; the full browser pass (two-file upload,
welcome page, quick action, not-found reply, settings, four mobile pages at 0 px
overflow) passed again on the restyled build with no console errors.

### Wide layout, green palette, new type — September 28, 2026

Switched to a fluid, left-anchored layout (nav beside the brand, content up to
1,720 px wide, a sticky right rail on the Ask page with the library, suggested
questions and links behind the last answer; topics and the three steps side by
side on Home). Restored the original warm paper and deep green palette, light,
with the purple values removed. Typefaces are now Bricolage Grotesque
(headings), Geist (text) and Geist Mono (labels), self-hosted through next/font
and confirmed by a computed-style check. Lint, TypeScript, 8 web tests and the
production build pass; the browser pass at 1,680 px (two-file upload, welcome
page, quick action answer, not-found reply, settings) and the four mobile pages
at 0 px overflow passed with no console errors.

### Hugging Face Space packaging — September 28, 2026

Added `hf-space/` (Dockerfile, Space card, `.dockerignore`, `deploy-space.sh`)
and a `CAMPUS_MODEL_DIR` setting so the embedding model can be baked into the
image. Docker is not installed on this Mac, so the image was not built here;
instead the assembled Space folder (29 files) was installed into a fresh Python
3.11 environment, the model-bake step ran (384 dimensions) and the API started
from that tree with the baked model, reporting `embeddings: ready`. Backend
tests: 100 passed. No Space was created; deployment is the owner's step.

### Frontend/backend sync for the hosted deployment — September 28, 2026

Goal: the whole application runs from the Vercel domain with the backend on a
Hugging Face Space. Checked on this Mac; no Space or Vercel project was created.

- `check-deploy.sh` added. It runs the checks the browser makes (`/api/status`
  header and body version, a workspace route, `/api/docs`; with `--full` an
  NDJSON upload, an NDJSON chat turn and a delete) against any origin.
- `lib/contract.ts` now classifies a reply: a missing contract header on an
  error reply is "unreachable" (proxy or host error page, sleeping or private
  Space, wrong rewrite target), while a wrong or missing header on a successful
  reply is "incompatible". Before, both showed "backend is out of date".
- The provider keeps checking `/api/status` while the backend is unreachable or
  its embedding model is loading, with backoff (3 s doubling to 30 s), so a
  page that rendered before a Space woke up recovers without a reload.
- Gradio 6.28.0 was installed in a scratch environment: `gr.Server` (a FastAPI
  subclass), `launch(_app=...)`, `theme`/`css` on `launch`, `api_visibility`
  and the `/gradio_api` prefix all exist, so `hf-space/app.py` uses real APIs.
- `hf-space/app.py` was run locally with Gradio mounted (no key, embeddings and
  OCR off): `/api/status` answered with `X-Campus-API-Version: 2` through the
  `/api` → `/campus-api` rewrite, the Gradio homepage and `/gradio_api/info`
  answered 200, and `./check-deploy.sh http://127.0.0.1:7861 --full` passed
  (upload: reading > text > chunking > indexing; chat: stage, retrieval,
  augmentation, done; status `sources_only`).
- The frontend was built with `CAMPUS_API_URL=http://127.0.0.1:7861` and
  served with `next start`; `./check-deploy.sh http://127.0.0.1:3123 --full`
  passed through the Next.js proxy with both streams intact, and the
  server-rendered badge read "Search only". With the backend stopped, the page
  still rendered (badge "Offline"), the proxied `/api/status` returned 500
  without the contract header, and the check script reported it as
  unreachable.
- `deploy-space.sh` now warns when the Space stays private: a private Space's
  `hf.space` URL needs a Hugging Face login the Vercel proxy cannot supply.
- Backend tests: 101 passed. Lint, TypeScript, 12 web tests and the
  production build pass.

Not verified: a real Space (ZeroGPU flavour availability, cold-start time,
`preload=False` leaving `embeddings: loading` until the first upload), Vercel's
proxy limits for a 40 MB upload and a 40 s streamed answer, and the live model.
