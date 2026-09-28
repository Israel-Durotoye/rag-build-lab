# Manual check: the exception survives into the answer

The notes contain one important exception: **"negative feedback does not guarantee stability."**
A good answer about negative feedback must keep it. Run this check after changing the notes, the chunking, the budget, the explanation logic or the model.

## Steps

1. Start the app (`python -m streamlit run demos/02-study-companion/app.py --server.address 127.0.0.1`).
2. For each combination below, set **Chunk strategy** and the **Expand small matches** toggle in the sidebar, press **Apply chunk strategy**, then ask `Does negative feedback guarantee stability?`.
3. Record whether the phrase appears in (a) **Explanation** and (b) **Supporting sections**.
4. Press **Reset conversation**, ask `What is negative feedback?`, then the follow-up `Does it guarantee stability?`, and record the same two things.
5. If a model is enabled, also check that the generated explanation does **not** say or imply that negative feedback always makes a system stable. Valid citation IDs alone do not prove this.

| Chunking | Expansion | Explanation keeps exception? | Supporting section keeps exception? | Checked by / date |
|---|---|---|---|---|
| section | on | | | |
| section | off | | | |
| fixed | on | | | |
| fixed | off | | | |
| model: ______ | | | | |

CLI equivalent for the offline rows:

```bash
python -m rag_core.cli --config demos/02-study-companion/config.json ask "Does negative feedback guarantee stability?" --chunking fixed --no-expand
```

The automated tests (`tests/test_study.py::test_definition_keeps_the_exception`) cover only the offline verbatim path. They cannot judge a model's wording.
