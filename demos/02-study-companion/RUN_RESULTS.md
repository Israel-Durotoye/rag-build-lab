# Study Companion run record

Checked locally on 28 September 2026: Python 3.13.5, SQLite 3.50.2, Streamlit 1.64.0, pytest 9.1.1. Offline keyword retrieval only. No generation model and no embedding model were running.

## Commands and results

| Command | Result |
|---|---|
| `python -m pytest -q` | 84 passed (69 before this iteration; adds 14 in `tests/test_study.py` and 1 Study Companion UI test) |
| `python scripts/evaluate_all.py` | 30/30 retrieval/status cases across 10 demos (Study Companion: 5/5) |
| `python -m pip check` | No broken requirements |
| `python demos/02-study-companion/compare_chunking.py` | Wrote `runs/chunking-section.json`, `runs/chunking-fixed.json` |
| `python demos/02-study-companion/compare_chunking.py --no-expand` | Wrote the two `-no-expansion` files |
| `streamlit run … --server.headless true` + `/_stcore/health` | `ok` (the app started. This was not a visual browser review) |
| `curl http://127.0.0.1:11434/api/tags` | No Ollama server, so the generated path was not run live |

One existing test (`test_chunking_preserves_exception_and_locations`) compared against the old fixture's location string. It now checks against the fixture's own `location` value.

## Chunking runs over the same eight questions

Keyword retrieval, k = 4, budget 250 words, expansion below 60 words, fixed windows of 40 words.
"Expected in context" counts questions where every expected section reached the context (7 questions have expected sections; q8 is the absent topic).

| Run | Expected in context | Mean context words | q8 absent topic | Exception kept (q1, q7) |
|---|---|---|---|---|
| section | 7/7 | 176.6 | insufficient evidence | yes, yes |
| fixed (expansion on) | 6/7 | 143.0 | insufficient evidence | yes, yes |
| section, expansion off | 7/7 (same as section: section chunks are never expanded) | 176.6 | insufficient evidence | yes, yes |
| fixed, expansion off | 6/7 | 108.4 | insufficient evidence | yes, yes |

The difference in these runs is q4, *"How does proportional control differ from integral action?"*. In fixed mode the `gain` (proportional control) section did not reach the top 4 retrieved chunks, so the context covers only integral action. The section run found both sections. Fixed mode used fewer context words on average.

These are observations on eight authored questions over one synthetic file. They do not show that either strategy is better in general, and no winner is declared.

## Manual exception check (performed by Claude via the CLI, 28 Sep 2026)

Question: `Does negative feedback guarantee stability?`

| Chunking | Expansion | Exception in explanation | Exception in supporting sections | Note |
|---|---|---|---|---|
| section | on | yes | yes | |
| section | off | yes | yes | |
| fixed | on | yes | yes | Three matched windows merged into one full section |
| fixed | off | yes | yes | Explanation includes a fragment cut at a chunk boundary: "or the measurement arrives with too much delay…" |

In fixed mode without expansion the exception survived because all three windows of the section matched on the section title and fit in k = 4. The fixed mode does not guarantee this in general. A model-generated answer has not been checked. Use [MANUAL_CHECK.md](MANUAL_CHECK.md) once a model is configured.
