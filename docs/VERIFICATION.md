# Verification record

Checked 26 September 2026 in the build environment:

- Python 3.12.14, SQLite 3.53.1, Streamlit 1.64.0, pytest 9.1.1.
- `python -m pytest -q`: 40 tests passed. Includes all ten Streamlit app startup/search checks, four special CLI workflows, SQLite persistence/update/delete, tenant filtering and revocation, policy boundaries, graph failure cases, arithmetic, controller limits and provider failure handling.
- `python scripts/evaluate_all.py`: 22 of 22 bundled synthetic retrieval/status cases passed across ten demos.
- `python -m pip check`: no broken requirements.

Generation tests use explicit test doubles, including a local HTTP server that checks the Ollama request/response contract. No actual Ollama model was running in this environment. Sentence Transformers models and the cross-encoder were not downloaded or evaluated. Their adapters follow the linked official APIs, but live inference and model quality remain unverified here.

The offline retrieval results are genuine executions, not fabricated measurements. They cover a small authored fixture set and do not establish broad accuracy, security, prompt-injection immunity or production readiness. UI checks use Streamlit AppTest; they are not a visual browser review.

The CI workflow is configured for Python 3.11 and 3.12. A remote CI run is not claimed until the repository has been uploaded and GitHub Actions has run.
