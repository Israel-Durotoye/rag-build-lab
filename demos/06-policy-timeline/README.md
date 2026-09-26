# Policy Timeline

Session 18 · A reader asking which version of a policy applied on a particular date.

## Run from repository root

```bash
python -m streamlit run demos/06-policy-timeline/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/06-policy-timeline/config.json ask "How many days of annual leave?" --as-of 2026-09-26
python -m rag_core.cli --config demos/06-policy-timeline/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask the same question for two dates, update a fixture, rerun the question and remove a source to demonstrate deletion.

## Scope and roadmap

Effective-date selection, version comparison, contextual follow-up and explicit update/delete commands. No real legal or employment advice.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

The requested effective date determines the version. Gaps and overlapping validity are visible. Updates change retrieval; deletion and permission changes invalidate affected caches.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
