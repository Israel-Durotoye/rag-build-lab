# Paper Compare

Session 15 · A reader comparing a narrow question across two research papers.

## Run from repository root

```bash
python -m streamlit run demos/05-paper-compare/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/05-paper-compare/config.json ask "What retrieval method is used?"
python -m rag_core.cli --config demos/05-paper-compare/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Compare a method detail, open both sources and show a field that only one source reports. Include an actual failure from the evaluation.

## Scope and roadmap

Choose two papers, ask one comparison question and receive fields with per-paper evidence and explicit gaps. No automatic quality leaderboard.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Each selected paper contributes its own evidence. Missing fields remain missing. Incomparable datasets or protocols are flagged. Results use counts and denominators.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
