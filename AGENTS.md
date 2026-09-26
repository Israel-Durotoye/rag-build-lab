# Repository working rules

Read README.md and docs/STATUS.md before extending a demo. Reuse rag_core; avoid ten copies of ingestion or provider code. Keep every demo independently runnable from its own app.py and config.json.

Use permitted or synthetic fixtures. Never commit secrets, environments, databases, model weights or private documents. Default to local source-search mode. Clearly label generation, OCR, semantic retrieval and planner capabilities according to what actually runs.

When editing retrieval or access rules, run the affected tests plus the tenant-boundary checks. Before a release run `python -m pytest -q` and `python scripts/evaluate_all.py`. Record actual results; never replace missing evidence with invented benchmark values.

Do not silently deploy apps, publish posts, create paid resources, or add autonomous action tools. Support Shelf's account selector is a local simulator, not authentication.
