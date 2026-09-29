# Verification record

Study Companion's website was built and checked locally on 29 September 2026 from
`demos/02-study-companion`: 78 backend tests and 31 frontend tests passed, with linting,
type checking and the production build; the root suite passed 87 tests and 30/30 retrieval
cases; and every page was driven in a headless browser with and without a model. Five live
replies to the exception question were recorded and read, and all kept the exception.
Campus Guide was re-run in full after its shared code moved to `rag_core/web` (101 backend
tests, 12 frontend tests, lint, types and build passed). Nothing was deployed. See
[the record](../demos/02-study-companion/WEB_RUN_RESULTS.md).

Campus Desk's TypeScript migration was verified from `demos/01-campus-desk`:
24 web tests, 7/7 web evaluation questions, type checking, linting and the production
build passed. See [web run results](../demos/01-campus-desk/WEB_RUN_RESULTS.md).

Study Companion was extended and checked locally on 28 September 2026: 84 tests passed
and 30/30 retrieval cases passed across all demos. No live model was run. See
[the Study Companion record](../demos/02-study-companion/RUN_RESULTS.md).

Campus Desk was extended and checked locally on 27 September 2026: 61 tests and
27/27 retrieval cases passed, with real-browser verification and a SQLite
cross-thread rerun fix. See [the detailed local record](../demos/01-campus-desk/RUN_RESULTS.md).
The earlier baseline record follows for context.

Checked 26 September 2026 in the build environment:

- Python 3.12.14, SQLite 3.53.1, Streamlit 1.64.0, pytest 9.1.1.
- `python -m pytest -q`: 40 tests passed. Includes all ten Streamlit app startup/search checks, four special CLI workflows, SQLite persistence/update/delete, tenant filtering and revocation, policy boundaries, graph failure cases, arithmetic, controller limits and provider failure handling.
- `python scripts/evaluate_all.py`: 22 of 22 bundled synthetic retrieval/status cases passed across ten demos.
- `python -m pip check`: no broken requirements.

Generation tests use explicit test doubles, including a local HTTP server that checks the Ollama request/response contract. No actual Ollama model was running in this environment. Sentence Transformers models and the cross-encoder were not downloaded or evaluated. Their adapters follow the linked official APIs, but live inference and model quality remain unverified here.

The offline retrieval results are genuine executions, not fabricated measurements. They cover a small authored fixture set and do not establish broad accuracy, security, prompt-injection immunity or production readiness. UI checks use Streamlit AppTest; they are not a visual browser review.

The CI workflow is configured for Python 3.11 and 3.12. A remote CI run is not claimed until the repository has been uploaded and GitHub Actions has run.
