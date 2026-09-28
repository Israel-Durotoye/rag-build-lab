# Campus Guide (Campus Desk demo)

**Website:** a Python (FastAPI) backend plus a Next.js frontend, both in this
directory. Start the backend with `npm run api` and the frontend with
`npm run dev`, then open <http://localhost:3000>. See the
[setup, architecture and deployment guide](WEB_README.md).
The Python/Streamlit commands below remain available as the original baseline.
The evaluation questions and answer-support checklist apply to both versions.

Two related apps share this folder. The **website, Campus Guide,** is a
student-facing guide for a school: its owner adds the school's documents (one
or many at once) and students ask questions; the Python backend
extracts it (PyMuPDF text layer, RapidOCR for scanned pages and text inside
images, python-docx for Word), retrieves matching passages per question with
hybrid search (stemmed BM25 via `rag_core`'s SQLite FTS5 index plus FastEmbed
semantic vectors), and has DeepSeek stream answers that must cite those
passages. The welcome page (school name, quick actions, topics) is written by
the model from the documents themselves — nothing is typed in by hand — and the
owner can edit the answer instructions on a Settings page. A "How it works"
section shows each layer — retrieval, augmentation, generation — for every
question. The **Python/Streamlit baseline** below searches
the official **Students' Handbook 2021–2025 of the Department of Mechatronics
Engineering, Federal University of Technology, Minna** (57 transcribed sections
in `corpus.json`, provenance in `manifest.json`) with real SQLite FTS5
retrieval and source excerpts, **not generated answers**. The web app keeps
that corpus only as its test and evaluation fixture.

## Setup and run

Python 3.11+ with SQLite FTS5 is required. From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-tested.txt -e '.[ui,test]'
python -m streamlit run demos/01-campus-desk/app.py --server.address 127.0.0.1
```

Open http://127.0.0.1:8501. On Windows, create the environment with `py -m venv
.venv` and activate it with `.venv\Scripts\Activate.ps1` in PowerShell. After
installation, the app also runs from its own directory with `python -m streamlit
run app.py --server.address 127.0.0.1`.

The CLI needs no third-party packages when run from the repository root:

```bash
python -m rag_core.cli --config demos/01-campus-desk/config.json ask 'What CGPA is required for a First Class degree?'
python -m rag_core.cli --config demos/01-campus-desk/config.json evaluate
```

The root `.env.example` documents optional provider settings. Export settings in
your shell; the app does not automatically load `.env` files. The default needs
no credentials, model download or network service.

## Optional models

For local generation, use an already installed Ollama model:

```bash
export RAG_GENERATOR=ollama
export OLLAMA_MODEL='YOUR_INSTALLED_MODEL'
export OLLAMA_HOST=http://127.0.0.1:11434
python -m streamlit run demos/01-campus-desk/app.py --server.address 127.0.0.1
```

For semantic retrieval, install `python -m pip install -e '.[semantic]'`, set
`RAG_EMBEDDING_MODEL` to a compatible Sentence Transformers model name or local
model path, and restart the app. Dense and hybrid choices then appear alongside
keyword search. A remote model identifier may download weights on first use.
The shared adapter uses `encode_query` and `encode_document`; use a current
Sentence Transformers version supporting both. No paid model is selected.
Live model inference is not part of the offline verification record.

## Inspectable pipeline

`Pipeline.ingest()` loads `corpus.json`; `Pipeline.retrieve()` searches without
generating; `Pipeline.respond()` handles evidence and optional generation;
`Pipeline.ask()` composes those steps. Section chunking preserves titles and IDs.
Stored chunks include document ID, chunk ID, source location, document version
and content hash. Responses include the corpus fingerprint and citation labels
built from stored metadata. `Pipeline.preview(source_id)` opens the stored text.

No matches produce `insufficient_evidence` without a model call. A model can also
report insufficient evidence. Model citations must identify retrieved chunks;
unknown IDs, IDs outside selected context and missing answer citations fail
validation, leaving passages available. Valid IDs do not establish factual support
for every claim. The app exposes the actual returned status and evidence.

## Seven fixed evaluation questions

| Question | Expected supporting section or status |
|---|---|
| What CGPA is required for a First Class degree? | `degree-classification` |
| What are the areas of specialization in the department? | `specializations` |
| How many weeks is SIWES II? | `industrial-training` |
| What are the UTME admission requirements? | `admission-utme` |
| What is the penalty for taking a GSM handset into the examination hall? | `misconduct-during-exam` |
| What are the hostel accommodation fees? | Insufficient evidence |
| Where does the campus shuttle stop? | Insufficient evidence |

These are fixed development checks in `evaluation.json`, not a held-out benchmark.
Section IDs map to `handbook:<section>:0`. Supported cases check that the section
is among returned passages; they do not measure generated answer accuracy.

## Manual answer-support checklist

- Confirm the collection notice names the active handbook and whether
  generation is enabled.
- Ask each fixed question; inspect the selected passage, section and version.
- For the First Class question, preserve the exact CGPA band (4.5 to 5.0) and
  do not blur it with the Vice Chancellor's List threshold, which is also 4.5.
- For SIWES II, retain the twenty-four-week duration and the rule that students
  on SIWES cannot register for courses that semester.
- If generation is enabled, match every factual claim to its cited passage.
  Verify each displayed reference matches a stored section. Mark plausible but
  unsupported answers as failures even when their citation IDs are valid.
- Ask both absent-topic questions; verify no invented fee or shuttle stop appears.
- Ask “What are the library late fees?” The handbook does not state a fee. Offline
  mode may retrieve library passages but must not turn them into a fee answer. A
  generated fee amount is an answer-support failure.
- Reset or reindex; verify the old result and follow-up context are cleared.
- Record the actual model name (if any), question, passages and observed failure.
  Do not substitute the automated retrieval score for this review.

## 75-second demo script

| Time | Action and narration |
|---|---|
| 0–10 s | Open Campus Desk. “This is the FUT Minna Mechatronics students' handbook. This run uses source search, so the passages are retrieved evidence, not an AI-written answer.” |
| 10–20 s | Expand “Read the handbook”; show the Grading System section, then collapse it. |
| 20–40 s | Search “What CGPA is required for a First Class degree?” Point to the passage beside the result and its stored citation label. Read the 4.5–5.0 band. |
| 40–55 s | Search “What are the hostel accommodation fees?” Show insufficient evidence and no passages. |
| 55–70 s | Search “What are the library late fees?” Explain that keyword overlap retrieves library passages even though the handbook states no fee amount. |
| 70–75 s | “Next is testing answerability on paraphrases and misleading matches. Seven fixed checks are not a claim of broad accuracy.” |

For a generation-enabled recording, name the actual model, explain that the
answer is generated, and perform the manual claim-support review first.

## Verification and limits

```bash
python -m pytest -q
python scripts/evaluate_all.py
python -m pip check
```

See [RUN_RESULTS.md](RUN_RESULTS.md) for actual local results and tested versions.
The UI defaults to an in-memory index; the CLI accepts `--db .state/campus.sqlite`
before `ask` to persist metadata and FTS5. Reindex after changing fixture files.
The Python baseline has no upload/PDF parser (the website does), and neither
version has production authentication, an answer cache or a calibrated
semantic answerability threshold. Keyword matching can miss paraphrases
and return irrelevant passages. Dense retrieval also needs relevance evaluation.

## Deployment instructions (not deployed)

On a host you control, copy the repository, create a Python environment and install
the dependencies above. Start from the repository root:

```bash
python -m streamlit run demos/01-campus-desk/app.py --server.address 0.0.0.0 --server.port 8501 --server.headless true
```

That binds all host interfaces. Restrict network access or put an authenticated
TLS reverse proxy in front before sharing outside a trusted network. The bundled
corpus is the public FUT Minna handbook; keep private documents out of this
prototype. Configure provider settings on the host and
ensure any selected model service is reachable there. Each browser session has
its own in-memory index. No hosting resources have been created.

## Official API references checked

- [Streamlit columns](https://docs.streamlit.io/develop/api-reference/layout/st.columns)
- [Streamlit AppTest](https://docs.streamlit.io/develop/api-reference/app-testing/st.testing.v1.apptest)
- [Sentence Transformer encoding API](https://sbert.net/docs/package_reference/sentence_transformer/model.html)
