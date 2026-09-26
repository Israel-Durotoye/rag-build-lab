# Field Notes Desk

Session 30 · A reader connecting facts across a permitted set of inspection and maintenance notes.

## Run from repository root

```bash
python -m streamlit run demos/10-field-notes-desk/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/10-field-notes-desk/config.json ask "What was found during inspection of PUMP-7?"
python -m rag_core.cli --config demos/10-field-notes-desk/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask a multi-document question, inspect the search history, show an unresolved case and open the release report with actual measurements.

## Scope and roadmap

A bounded read-only search loop, evidence history, citations, explicit unresolved state and a release report. Reuse prior components; do not combine every optional feature.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

At most three retrieval calls. Unknown tools and invalid arguments fail. Repeated queries stop. Held-out questions, timeout, deletion and generation-outage tests are recorded.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
