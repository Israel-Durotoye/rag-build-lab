# TypeScript web verification — 27 September 2026

The complete Next.js application is in `demos/01-campus-desk`, including frontend,
API routes, retrieval code, tests, package lock, environment example and scripts.
It was rebuilt and tested from this final location. Vercel Root Directory is
`demos/01-campus-desk`; no deployment has been created.

## Tested versions

Node.js 22.17.0, npm 10.9.2, Next.js 16.3.6, React/React DOM 19.3.0,
TypeScript 6.0.3, tsx 4.23.15, ESLint 9.39.5, lucide-react 1.48.0.
Exact dependencies are recorded in this folder's package files.

## Actual checks

Commands below ran inside this demo directory after relocation:

| Command | Result |
|---|---|
| `npm run lint` | Passed, no errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | 24 passed, 0 failed, 0 skipped |
| `npm run evaluate` | 7/7 fixed retrieval/status questions passed |
| `npm run build` | Production build passed; page, search API and source API emitted |
| `npm start` | Production app served on http://127.0.0.1:3000 |

The existing Python suite also ran during the migration: **61 passed** in 7.10s,
including tenant-boundary checks. Its ten-demo evaluation remained **27/27**.
These Python commands run from the repository root.

The TypeScript tests cover section metadata and hashes, revision changes,
duplicate IDs, rejection of tenant documents, invalid request bodies and sizes,
unavailable modes, cross-demo source rejection, request isolation, citation
validation, model abstention/failure, and dense/hybrid adapter wiring.

## Browser checks

Tested the production server through isolated Chrome browser automation:

- Desktop at 1440 × 1100: initial page, sample library-hours query, original
  source text, source dialog, copy confirmation, and Escape dismissal.
- Tuition query: insufficient-evidence result with no selected passages.
- Mobile at 390 × 844: responsive page, working sample search, stacked evidence
  cards and source dialog. Document width equaled viewport width (390px), with
  no horizontal overflow.
- No page errors or console errors were reported in the final browser checks.

Screenshots and evaluation output are local, Git-ignored artifacts in `reports/`:

- `campus-typescript-desktop.png`
- `campus-typescript-mobile.png`
- `campus-typescript-mobile-results.png`
- `campus-typescript.json`

## Fixes and limitations

Type checking exposed a test/config typing mismatch caused by Next.js requiring
`NODE_ENV` on `ProcessEnv`; provider configuration now accepts an explicit
read-only environment map. Linting caught a plain home anchor, changed to Next's
Link component. All final checks above passed after those fixes and relocation.

The web implementation uses TypeScript BM25 over the public fixture, not SQLite
FTS5. Its rankings and hashes are not asserted to match the Python implementation
exactly. Source-search mode does not generate an answer from keyword overlap.

Ollama generation/embedding adapters were contract-tested with explicit test
doubles; no live model was installed or queried. Semantic answerability and
generated-claim support remain unverified. Seven synthetic fixture checks are
not a real-world accuracy benchmark. Remote Vercel deployment and GitHub Actions
execution remain unverified until published.
