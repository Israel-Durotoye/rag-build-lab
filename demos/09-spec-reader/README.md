# Spec Reader

Session 27 · An engineering student inspecting a diagram or table and checking a simple calculation.

## Run from repository root

```bash
python -m streamlit run demos/09-spec-reader/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/09-spec-reader/config.json ask "What is the capacity of cell A?"
python -m rag_core.cli --config demos/09-spec-reader/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask a diagram question, inspect the image, run one calculation and show the ambiguous-input response.

## Scope and roadmap

Page retrieval and inspection, a documented OCR or visual route, table source references and one deterministic unit-aware calculation. No arbitrary formula execution.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

The original page remains accessible. OCR-only mode is labelled accurately. Missing or incompatible units block calculations. Arithmetic uses validated input rows and exposes the formula.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
