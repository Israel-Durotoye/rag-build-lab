# Support Shelf

Session 21 · A support worker finding answers in the documents their account can access.

## Run from repository root

```bash
python -m streamlit run demos/07-support-shelf/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/07-support-shelf/config.json ask "What is the returns window?" --identity alice
python -m rag_core.cli --config demos/07-support-shelf/config.json evaluate
```

The default is real keyword retrieval with source excerpts, **not generated answers**. See the root README to enable local generation or semantic retrieval.

## Demo sequence

Switch between synthetic accounts, compare permitted answers and show a denied direct source request plus an injection fixture.

## Scope and roadmap

Read-only answering with server-controlled identity fixtures, per-tenant retrieval and source access, isolated caches and a harmless injection test. Local demo until real authentication is implemented.

The current feature matrix in `docs/STATUS.md` distinguishes shipped baseline features from future work in the original brief. Small synthetic fixtures intentionally keep this runnable on a laptop.

## Checks to expand before showcasing

Cross-tenant search, direct source access, exports and cache access fail. Revoked access stops retrieval. Document instructions cannot grant tools or permissions.

## Data

Read `manifest.json`. All fixtures here are synthetic. Replace them only with material you have permission to use. No private uploads are provided.
