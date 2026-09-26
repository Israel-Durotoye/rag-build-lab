# Repo Guide

Session 12 · A new contributor trying to locate the implementation of a behaviour.

## Run from repository root

```bash
python -m streamlit run demos/04-repo-guide/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/04-repo-guide/config.json ask "What is the retry limit?"
python -m rag_core.cli --config demos/04-repo-guide/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Ask where a behaviour is implemented, open the cited lines and ask about something absent from the repository.

## Scope and roadmap

Read-only indexing of code and documentation, file and line references, optional reranking and an evidence browser. No code execution or autonomous modifications.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Citations resolve to the indexed revision. Secret-like fixtures are excluded. Reranking is compared with a baseline. An undocumented setting produces a limited answer.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
