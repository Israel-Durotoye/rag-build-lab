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

Use permitted or synthetic fixtures. Never commit secrets, environments, databases, model weights or private documents. Default to local source-search mode. Clearly label generation, OCR, semantic retrieval and planner capabilities according to what actually runs.

When editing retrieval or access rules, run the affected tests plus the tenant-boundary checks. Before a release run `python -m pytest -q` and `python scripts/evaluate_all.py`. Record actual results; never replace missing evidence with invented benchmark values.

Do not silently deploy apps, publish posts, create paid resources, or add autonomous action tools. Support Shelf's account selector is a local simulator, not authentication.
