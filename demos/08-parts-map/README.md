# Parts Map

Session 24 · A reader following documented relationships between fictional parts and assemblies.

## Run from repository root

```bash
python -m streamlit run demos/08-parts-map/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/08-parts-map/config.json ask "Which part does assembly A use?"
python -m rag_core.cli --config demos/08-parts-map/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask a two-hop question, inspect each relationship source and demonstrate a missing edge.

## Scope and roadmap

Curated graph-assisted retrieval, a bounded two-hop traversal, source-backed edges and a passage-only baseline. This is not the full Microsoft GraphRAG pipeline.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Every claimed edge has evidence. Missing edges do not become inferred compatibility. Entity ambiguity triggers clarification. The baseline comparison discloses extra curated information.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
