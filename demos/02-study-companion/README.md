# Study Companion

Session 6 · A student trying to understand a particular set of notes.

Ask a question about the notes and get three things: an explanation, the exact
supporting sections, and the original source text. You can ask one follow-up per
topic. The sidebar switches between section-aware and fixed-length chunking so
you can compare them on the same questions.

## Setup and run (from the repository root)

Python 3.11+ and SQLite with FTS5 are required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[ui,test]'
python -m streamlit run demos/02-study-companion/app.py --server.address 127.0.0.1 --server.port 8502
```

Command-line interface (runs without Streamlit):

```bash
python -m rag_core.cli --config demos/02-study-companion/config.json ask "What is negative feedback?"
python -m rag_core.cli --config demos/02-study-companion/config.json ask "What is negative feedback?" --chunking fixed
python -m rag_core.cli --config demos/02-study-companion/config.json ask "What about windup?" --previous "What does integral action do?"
python demos/02-study-companion/compare_chunking.py            # writes runs/chunking-section.json and runs/chunking-fixed.json
python demos/02-study-companion/compare_chunking.py --no-expand # same questions, parent expansion off
python -m pytest -q tests/test_study.py tests/test_ui.py
```

## What runs

| Part | Behaviour |
|---|---|
| Retrieval | Real SQLite FTS5 keyword search (BM25). Dense and hybrid modes appear when `RAG_EMBEDDING_MODEL` is set (see `.env.example`). |
| Chunking | **section**: one chunk per heading. **fixed**: `chunk_words` (40) word windows inside each section. Windows never cross a heading, so every chunk keeps its section and location. |
| Parent expansion | A matched chunk that is part of a section and shorter than `expand_below_words` (60) is replaced by its whole parent section. Sections are added in rank order while the total stays within `context_budget_words` (250). A match that does not fit is left out and listed in `context_budget.skipped`. The top match is always kept, even if it alone exceeds the budget; `over_budget` flags that case. Section chunks are already whole sections, so they are never expanded. Toggle it in the sidebar or pass `--no-expand`. |
| Explanation | **Offline (default)**: source-search mode. Up to four *verbatim* sentences from the supporting sections, ranked by keyword overlap, with a small boost for qualifier words (not, unless, except, however, but). It is labelled as not generated. **With a model** (`RAG_GENERATOR=ollama` or `openai`): the model sees only the supporting sections. Its citation IDs must belong to them, or the app falls back to the verbatim sentences and shows an error. |
| Follow-up | A question starting with "What about", "And", "Does it", "Is that", "How does it" (and similar) is a follow-up. It is sent as a new retrieval with the earlier *question* added (`topic\nFollow-up: question`). Earlier answers are never carried over or used as evidence. One follow-up per topic. A second one asks you to write a complete question or reset. A follow-up with no topic asks you to name one. |
| Stored metadata | Each chunk and context item records document ID, chunk or context ID, section, location, document version and SHA-256 content hash. Each result records the corpus version (index fingerprint). |
| Reset | **Reset conversation** clears the topic, the follow-up count and the result. Changing the chunk strategy also resets them. |

Settings live in `config.json` (`chunk_words`, `study.k`, `study.context_budget_words`, `study.expand_below_words`).
The workflow code is in `rag_core/study.py` and is shared with the CLI. `app.py` only renders it.

## Sample questions

- Definition: `What is negative feedback?` · `Define steady-state error`
- Comparison: `Compare open-loop and closed-loop control` · `How does proportional control differ from integral action?`
- Follow-up: ask `What does integral action do?`, then `What about windup?`
- Exception: `Does negative feedback guarantee stability?` (the answer must keep "does not guarantee stability")
- Absent topic: `Explain the Kalman filter` (should return insufficient evidence)

The fixed eight-question set is in `questions.json`. The saved runs are in `runs/`, and the results are summarised in [RUN_RESULTS.md](RUN_RESULTS.md).

## Data

`corpus.json` is one synthetic, original set of control-systems notes written for this repository (see `manifest.json`). It has eight headed sections, each with a definition and an example. The notes contain one important exception: *negative feedback does not guarantee stability*. Replace them only with notes you have permission to use. No uploads or private data are included.

## Limitations

- Keyword retrieval abstains only when no query word matches. That is not a calibrated answerability check: an unrelated word match still returns sources, and paraphrases can be missed.
- Follow-up detection is a fixed list of opening phrases. Pronoun-heavy questions that start differently are treated as new topics.
- The verbatim explanation is picked by keyword overlap. It can include loosely related sentences or miss the key one, and in fixed mode without expansion it can show a fragment cut at a chunk boundary. It does not paraphrase or reason.
- No live model was run while building this iteration. The generated-explanation path is covered only by test doubles. Check model output against the supporting sections yourself.
- The chunking comparison uses eight authored questions over one small file. It shows differences on these questions only. It is not a benchmark, and neither mode is declared better.
- Quizzes are out of scope.

## Deployment (not performed)

Nothing has been deployed. To self-host on a machine you control, run the Streamlit command above behind your own reverse proxy with authentication, leaving `--server.address 127.0.0.1` in place. For Streamlit Community Cloud, point a new app at `demos/02-study-companion/app.py` in your fork. Install the repository with `pip install -e '.[ui]'`, for example through a root `requirements.txt` containing `-e .[ui]`, and set any generation variables as app secrets, never in the repo. Both options are free to start, but check current pricing and terms yourself before exposing any notes publicly.

## Tested versions

Checked 28 September 2026 with Python 3.13.5, SQLite 3.50.2, Streamlit 1.64.0 and pytest 9.1.1 (see [RUN_RESULTS.md](RUN_RESULTS.md)).
