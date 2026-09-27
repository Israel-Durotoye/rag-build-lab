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
