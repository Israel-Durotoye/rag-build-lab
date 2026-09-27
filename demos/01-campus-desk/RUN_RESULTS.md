# Campus Desk local run results

Checked 27 September 2026 on macOS, using the repository's `.venv`.

## Environment

- Python 3.13.5 (Anaconda distribution), SQLite 3.50.2 with FTS5.
- Streamlit 1.64.0, pytest 9.1.1; these match `requirements-tested.txt`.
- Actual installed dependency snapshot: `reports/campus-dependencies.txt` (local,
  ignored by Git). No model weights or live generation services were installed.

## Commands and observed results

Run from the repository root:

```bash
.venv/bin/python -m pytest -q
# 61 passed in 4.41s
.venv/bin/python -m rag_core.cli --config demos/01-campus-desk/config.json evaluate
# 7 passed / 7 cases, keyword source-search mode
.venv/bin/python scripts/evaluate_all.py
# 10 demos, 27 passed / 27 cases; writes reports/retrieval.json
.venv/bin/python -m pip check
# No broken requirements found.
git diff --check
# No whitespace errors.
```

The tests cover ingestion and persisted provenance, the seven fixed questions,
metadata-derived citation labels, invalid/out-of-context citations, model
abstention and no-evidence behavior. They also include all ten UI entry points,
Campus Desk's evidence columns/reset/reindex behavior, tenant boundaries and
revocation, and the existing shared-core/provider/workflow regression checks.

## Browser verification

Started locally in source-search mode:

```bash
RAG_GENERATOR=none RAG_EMBEDDING_MODEL= RAG_RERANKER_MODEL= \
  .venv/bin/python -m streamlit run demos/01-campus-desk/app.py \
  --server.address 127.0.0.1 --server.port 8501 \
  --server.headless true --browser.gatherUsageStats false
```

Verified with an isolated Chrome session using the installed agent-browser CLI:

- The app loads and labels source-search mode explicitly.
- The library-hours query shows the stored weekday/weekend passage alongside the
  result, with its title, section, document version and source ID.
- The tuition question displays insufficient evidence with no selected passages.
- The library late-fee question retrieves keyword matches but produces no fee
  answer; the UI explains that a passage may not answer the question.
- Reindexing clears the old result, and subsequent search works.
- No page errors or fresh console messages were reported in the final checks
  after clearing the earlier server-restart connection warnings.
- Local screenshot: `reports/campus-desk.png` (ignored by Git).

## Failures encountered and resolved

The sandbox initially blocked package downloads and localhost socket binding.
Dependency installation and the provider HTTP test succeeded after granting the
required execution permissions; no test was removed or skipped to hide this.

The first real browser search revealed `sqlite3.ProgrammingError`: Streamlit
reruns used a different thread from the one that created the session's connection.
AppTest alone did not expose this. The index now permits thread changes and uses
a reentrant lock around complete operations, including atomic reindexing. A new
threaded search/preview/reindex regression test and a restarted browser run pass.

## Limits and next unresolved issue

Seven authored retrieval checks do not establish broad answer accuracy. Live
Ollama generation and Sentence Transformers inference were not run. Model doubles
and the HTTP contract server are used only in automated tests.

The next unresolved issue is **semantic answerability**: a question about library
late fees retrieves library passages, although no passage states a fee. Offline
mode correctly avoids generating a claim but cannot classify all such questions
as unanswerable. Add held-out paraphrases and misleading-overlap questions, then
evaluate an actual configured model against the manual answer-support checklist
before choosing a relevance/abstention policy. Valid citation IDs are not proof
that generated claims are supported.
