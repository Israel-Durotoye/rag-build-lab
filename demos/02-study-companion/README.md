# Study Companion

Session 6 · A student trying to understand a particular set of notes.

## Run from repository root

```bash
python -m streamlit run demos/02-study-companion/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/02-study-companion/config.json ask "Does negative feedback guarantee stability?"
python -m rag_core.cli --config demos/02-study-companion/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask about a concept, open its section and ask a follow-up. Show a failed or unsupported topic and the resulting limitation.

## Scope and roadmap

Section-aware retrieval, source expansion, a short explanation and one contextual follow-up. Keep the original notes available. Quiz mode is optional.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Compare fixed-size and section-aware chunks on the same questions. A definition keeps its qualifying assumptions. A missing topic produces a gap. Follow-ups retrieve fresh source evidence.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
