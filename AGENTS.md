# Repository working rules

Read README.md and docs/STATUS.md before extending a demo. Reuse rag_core; avoid ten copies of ingestion or provider code. Keep every demo independently runnable from its own app.py and config.json.

Keep every new frontend and backend inside its corresponding demos/<demo> folder,
including application code, dependencies, tests, and build configuration.
Campus Desk's website (branded Campus Guide) is entirely in demos/01-campus-desk: a Python (FastAPI)
backend in backend/ that reuses rag_core, and a Next.js frontend that only renders
the interface. Preserve the Python entry points for the learning demos. For web
changes, from demos/01-campus-desk run npm run test:api, npm run lint,
npm run typecheck, npm test and npm run build. See demos/01-campus-desk/WEB_README.md
for setup and deployment.

Study Companion's website is entirely in demos/02-study-companion, built the same
way: a Python (FastAPI) backend in backend/ and a Next.js frontend, on ports 8001
and 3001 so both sites can run together. From demos/02-study-companion run the same
five commands. See demos/02-study-companion/WEB_README.md.

Finder (Manual Finder) is entirely in demos/03-manual-finder, built the same way,
on ports 8002 and 3002. From demos/03-manual-finder run the same five commands.
See demos/03-manual-finder/WEB_README.md. Its sample library is real documentation
fetched at pinned commits (library/fetch_sources.py) and built by
library/build_corpus.py; never edit corpus.json by hand, and give every tag
correction in library/models.json its reason.

What more than one website needs lives in rag_core/web (extraction, OCR, embeddings,
hybrid retrieval, citation checks, NDJSON helpers, test doubles). Add shared backend
code there, not as a copy in a second demo. After changing rag_core/web or rag_core,
run the backend tests of every website (npm run test:api in each) and the root suite.
A demo's own rules stay in its backend: Campus Guide's chunking and welcome page,
Study Companion's sections, context budget and practice checks, Finder's model
tagging, code index and clarification rules.

Use permitted or synthetic fixtures. Never commit secrets, environments, databases, model weights or private documents. Default to local source-search mode. Clearly label generation, OCR, semantic retrieval and planner capabilities according to what actually runs.

When editing retrieval or access rules, run the affected tests plus the tenant-boundary checks. Before a release run `python -m pytest -q` and `python scripts/evaluate_all.py`. Record actual results; never replace missing evidence with invented benchmark values.

Do not silently deploy apps, publish posts, create paid resources, or add autonomous action tools. Support Shelf's account selector is a local simulator, not authentication.
