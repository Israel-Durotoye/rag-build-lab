# Campus Desk — TypeScript web app

Campus Desk now has a Next.js App Router application entirely inside `demos/01-campus-desk`.
The interface, search API, retrieval pipeline, and optional model adapters are
TypeScript. Vercel can build and run this app without Python or Streamlit.

## Run locally

Use Node.js 22 and npm. From the repository root:

```bash
cd demos/01-campus-desk
npm ci
npm run dev
```

Open http://localhost:3000. Run all npm commands inside `demos/01-campus-desk`.
For a production build:

```bash
npm run build
npm start
```

The default needs no API keys, database, network model service, or model download.
The existing Python demos remain available via their own `app.py` entry points.
Campus Desk's old Streamlit entry point is retained as the original baseline;
use the Next.js app for the website and Vercel deployment.

## What migrated

- Responsive interface with sample questions, follow-ups, reset, and error states.
- Handbook browsing and original-source dialogs, including copyable citations.
- Real server-side keyword retrieval over the 57 sections transcribed from the
  official FUT Minna Mechatronics Engineering Students' Handbook 2021–2025.
- Document/section identifiers, SHA-256 content hashes, corpus revision and stored
  metadata-derived labels. Unknown and out-of-context model citations are rejected.
- Explicit source-search mode, insufficient-evidence state and generation fallback.
- Optional Ollama generation, dense search and hybrid reciprocal rank fusion.
- The same seven evaluation questions as the Python demo.

`lib/retrieval.ts` implements BM25 in TypeScript, replacing SQLite FTS5 for this
small immutable web corpus. Rankings and corpus fingerprints are not claimed to
be byte-for-byte identical to Python. Both implementations read
`corpus.json` and `evaluation.json` in this demo folder; no fixture copy is needed.
The web app bundles only Campus Desk's public handbook. Tenant-tagged
fixtures are rejected by its ingestion path. This is not production authentication.

### Your school's knowledge base

The **Your school** page (`/school`) is for students at another university: it
takes a pasted handbook (split into sections by headings), a JSON import, or
manually written sections, validates them against the limits in `lib/school.ts`,
and stores them in that browser's local storage. When that knowledge base is
active, each search request carries the documents in the `documents` field and
the server validates and indexes them for that request only — nothing is stored
server-side, and tenant-tagged documents are still rejected. The FUT Minna
handbook remains the built-in default.

There is no writable server database, global chat history, or answer cache.
Update `corpus.json` and redeploy to update the hosted handbook. The original
Streamlit reindex button is therefore not needed on the website. Conversation
context is kept in the browser's current page state and sent explicitly per
request; refreshing or clicking New search clears it.

## Optional model configuration

Leave all `CAMPUS_*` variables unset for source search. To reuse an existing Ollama
service, put these in `.env.local` locally or Vercel's server-side environment
settings. This folder’s `.env.example` lists the web settings. The repository-root example
remains for the Python demos.

```bash
CAMPUS_OLLAMA_HOST=http://127.0.0.1:11434
CAMPUS_OLLAMA_MODEL=your-installed-generation-model
CAMPUS_EMBEDDING_MODEL=your-installed-embedding-model
CAMPUS_MODEL_TIMEOUT_MS=20000
# Only for a service that requires Bearer authentication:
CAMPUS_OLLAMA_TOKEN=
```

Both model names are optional and independent. Setting only the embedding model
enables dense/hybrid modes without generation. This uses Ollama `/api/embed`,
not the Python Sentence Transformers adapter. No models are pulled automatically.
Never use `NEXT_PUBLIC_` for provider credentials.

On Vercel, localhost refers to the Vercel runtime, not your PC. An optional model
service must already be reachable from the deployment; use HTTPS and service
authentication when applicable. Default keyword search needs none of this. Live
model inference is not claimed by the adapter contract tests. Protect access and
set appropriate usage limits before exposing model-backed generation publicly.

## Deploy to Vercel

No deployment has been created by this migration. When ready:

1. Commit the web app files, shared handbook fixture and `package-lock.json` to
   the GitHub repository.
2. Import the repository in Vercel. Select **Next.js**, with **`demos/01-campus-desk`**
   as Root Directory. Both the frontend and API backend live there.
3. Use **Node.js 22.x**, install command `npm ci`, build command `npm run build`,
   and leave Output Directory at the Next.js default.
4. Leave provider variables unset for the working source-search demo. Deploy a
   preview and check the First Class CGPA question, an absent topic (hostel
   fees), source previews, and the Your school page before promoting.

Alternatively, from `demos/01-campus-desk` with the Vercel CLI already installed:

```bash
vercel
```

Next.js is supported directly, so this app needs no custom Vercel routing file,
Python deployment, persistent SQLite file, or paid integration. Deployment itself
is a separate publishing action; the migration only prepares and verifies it.

## Check the implementation

See [actual local run results](WEB_RUN_RESULTS.md) for tested versions, browser
checks, and remaining limitations.

```bash
npm run lint
npm run typecheck
npm test
npm run evaluate
npm run build
```

The evaluation command writes `reports/campus-typescript.json`. Tests use Node's
test runner with `tsx` to execute TypeScript. Provider mocks are confined to tests.
The GitHub Actions web job runs linting, type checking, tests, evaluation and build;
it does not deploy. The Python job continues to verify the other demos.

The manual answer-support checklist, seven questions, and 75-second demo script
remain in the [Campus Desk README](README.md). In the new
interface, use **Browse handbook**, **View source**, and **New search**. The search
results show original passages; generated answers appear only when configured.

## Code map

All paths below are relative to `demos/01-campus-desk`. No web application code or
Node package files live at the repository root.

| Path | Purpose |
|---|---|
| `app/page.tsx` | Server-rendered page and public capability settings |
| `components/campus-desk.tsx` | Interactive interface and source previews |
| `app/school/page.tsx` | Knowledge-base chooser for another school's handbook |
| `components/school-manager.tsx` | Add, split, import, export and activate a school KB |
| `app/api/search/route.ts` | Validated, bounded POST search endpoint (default or supplied KB) |
| `app/api/sources/[id]/route.ts` | Stored source record; unknown IDs return 404 |
| `lib/retrieval.ts` | Section ingestion, hashes, BM25, cosine and rank fusion |
| `lib/pipeline.ts` | Search/answer composition and citation validation |
| `lib/school.ts` | Shared school-KB validation, browser storage and text splitter |
| `lib/providers.ts` | Configurable server-side Ollama adapters |
| `web-tests/` | Retrieval, API, citation and provider contract tests |

## Remaining limits

Keyword matches can be irrelevant and can miss paraphrases. “What are the library
late fees?” retrieves library passages that do not state a fee; default source
search does not invent an answer. Neither BM25 nor dense cosine scores are an
answerability classifier. Valid citation IDs do not guarantee factual support.
There is no PDF parser or OCR: another school's handbook is added as pasted
text, sections or JSON on the Your school page, and lives only in that browser.
No authentication, reranker, or persistent embedding store is included in
this web version. Model vectors are recomputed per corpus when used.

## Official references used

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Route handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Ollama chat](https://docs.ollama.com/api/chat)
- [Ollama embeddings](https://docs.ollama.com/api/embed)
