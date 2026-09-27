# Campus Desk — TypeScript web app

Campus Desk is a Next.js App Router application entirely inside
`demos/01-campus-desk`, built to show how retrieval-augmented answering works:
you add a PDF or Word document in the browser, the app extracts and indexes it,
and every answer is grounded in cited passages from that file. Extraction,
retrieval, the search API and the DeepSeek adapter are all TypeScript.

## How it works

1. **Add a document (browser).** The visitor drops a PDF or Word file onto the
   page. `lib/extract.ts` reads it locally: pdf.js extracts each page's text
   layer, and pages with no text layer (scanned pages) are rendered to a canvas
   and read with tesseract.js OCR. Word files go through mammoth. Nothing is
   uploaded anywhere at this stage.
2. **Index (browser).** The extracted pages are grouped into titled sections
   with page locations (`p. 12`), validated against the limits in
   `lib/school.ts`, and kept in that browser's local storage only.
3. **Retrieve (server, per request).** Each question is POSTed together with
   the document sections. The server re-validates them, indexes them for that
   request (small in-memory LRU), and ranks sections with BM25
   (`lib/retrieval.ts`). Nothing is stored server-side.
4. **Generate (server, optional).** With an AgentRouter key configured, the top
   passages and the question go to a DeepSeek model, which must answer as JSON
   with citation IDs. Citations are validated against the supplied passages;
   invalid answers fall back to showing the passages. Without a key the app
   runs in source-search mode and shows the passages directly.

The interface's **How this answer was made** disclosure walks an audience
through exactly these steps with the live numbers from their own question.

There is no bundled default corpus in the web app anymore: `corpus.json` (the
FUT Minna handbook transcription) remains as the shared fixture for tests, the
retrieval evaluation and the Python baseline.

## Workspace interface

The responsive dark workspace has four views: **Workspace**, **Documents**,
**Recent questions**, and **How it works**. The left sidebar opens those views
and revisits this session’s questions. The right panel shows document metadata,
section shortcuts, and the complete text of a selected source, with a copy-citation
action. On smaller screens, the panel opens above the content when a source is
selected and can be toggled from the header.

The Documents view filters section titles and text. New question clears follow-up
context; recent questions restore their answer without another model request.
History keeps the last 20 results in page memory only and clears when a document
is replaced or removed. Document storage, PDF/OCR extraction, retrieval and
provider configuration retain the behavior described above.

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

Source-search mode needs no API keys or network services. PDF text extraction
runs fully in the browser; the pdf.js worker and tesseract.js OCR assets load
from version-pinned jsDelivr CDNs, so OCR of scanned pages needs an internet
connection.

## Model configuration (DeepSeek via AgentRouter)

Copy `.env.example` to `.env.local` (gitignored) and set the key:

```bash
AGENTROUTER_API_KEY=your-key
AGENTROUTER_MODEL=deepseek-v4-flash
AGENTROUTER_BASE_URL=https://agentrouter.org/v1
AGENTROUTER_TIMEOUT_MS=50000
```

The key stays server-side; never use `NEXT_PUBLIC_` for provider credentials.
AgentRouter is an OpenAI-compatible relay; note that it only accepts requests
identifying as one of its supported CLI clients, so `lib/providers.ts` sends a
compatible User-Agent (override with `AGENTROUTER_USER_AGENT`). Answers are
labeled in the interface with the exact model that wrote them. If the model is
unavailable, times out, or cites unknown sources, the app falls back to the
retrieved passages with an explicit notice.

## Deploy to Vercel

1. Commit the web app files and `package-lock.json` (never `.env.local`).
2. Import the repository in Vercel: framework **Next.js**, Root Directory
   **`demos/01-campus-desk`**, Node.js 22.x, install `npm ci`, build
   `npm run build`.
3. Add the `AGENTROUTER_*` variables in Vercel's server-side environment
   settings if AI answers are wanted; leave them unset for source-search mode.
4. Check a preview first: add a PDF, ask a question it answers, ask one it
   doesn't (insufficient-evidence state), and open a scanned PDF for the OCR
   path. Deployment is a separate publishing action you take deliberately.

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

The evaluation command writes `reports/campus-typescript.json`: fixed retrieval
checks over the fixture handbook corpus, not an answer-quality benchmark. Tests
use Node's test runner with `tsx`; provider calls are mocked in tests and no
live model is queried by them.

## Code map

All paths below are relative to `demos/01-campus-desk`.

| Path | Purpose |
|---|---|
| `app/page.tsx` | Server-rendered page; passes capability flags only |
| `components/campus-desk.tsx` | Workspace navigation, uploads, section browser, session history and source panel |
| `components/answer-panel.tsx` | Answers, supporting passages and copy response |
| `components/workspace-flow.tsx` | Document-to-answer flow diagram and guide |
| `app/api/search/route.ts` | Validated, bounded POST search endpoint (documents required) |
| `lib/extract.ts` | Browser-side PDF text layer + OCR + Word extraction and sectioning |
| `lib/school.ts` | Shared document validation, limits, browser storage, text splitter |
| `lib/retrieval.ts` | Section ingestion, hashes, BM25, cosine and rank fusion |
| `lib/pipeline.ts` | Search/answer composition and citation validation |
| `lib/providers.ts` | Server-side DeepSeek-via-AgentRouter generation adapter |
| `web-tests/` | Retrieval, extraction, API, citation and provider contract tests |

## Remaining limits

Keyword matches can be irrelevant and can miss paraphrases; BM25 scores are not
an answerability classifier, and valid citation IDs do not guarantee factual
support — the passages are always shown for verification. OCR quality depends
on scan quality and only English is loaded. Very large files are trimmed to the
shared knowledge-base limits (200 sections / ~860k characters, OCR capped at
120 image pages) with a visible notice. Documents live in one browser's local
storage; there is no server database, authentication, reranker, or persistent
embedding store.

## Official references used

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Route handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [pdf.js](https://mozilla.github.io/pdf.js/)
- [tesseract.js](https://tesseract.projectnaptha.com/)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js)
