# Manual Finder

Session 9 · Someone searching a manual by device code or a plain-language symptom.

## Run from repository root

```bash
python -m streamlit run demos/03-manual-finder/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/03-manual-finder/config.json ask "What does E17 mean?" --device M1
python -m rag_core.cli --config demos/03-manual-finder/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Run an exact fault-code query and a symptom query, compare the retrieved IDs, then omit the device name and show clarification.

## Scope and roadmap

Device selector, keyword and dense retrieval, rank fusion and clarification when device identity matters. Informational lookup only.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Exact identifiers and paraphrases are tested separately. Wrong-device passages are excluded when the device is known. Rank fusion uses ranks, not arbitrary addition of raw scores.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
