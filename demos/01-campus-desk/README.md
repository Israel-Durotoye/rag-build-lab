# Campus Desk

Session 3 · A student looking for a detail in a short handbook.

## Run from repository root

```bash
python -m streamlit run demos/01-campus-desk/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/01-campus-desk/config.json ask "When does the library close?"
python -m rag_core.cli --config demos/01-campus-desk/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Open the sample handbook, ask one supported question, expand the source, then ask an out-of-scope question. End with one observed limitation.

## Scope and roadmap

One collection, one question box, an answer, source excerpts and an explicit insufficient-evidence state. No accounts, crawling or document management dashboard.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Five answerable questions have known supporting sections. Two unanswerable questions must not receive invented handbook facts. A source reference must open the stored section. A clean setup must reproduce the demo.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
