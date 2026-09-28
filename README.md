# RAG Build Lab

Ten separately runnable demos sharing one inspectable Python retrieval core. Built for Israel Durotoye's 30-session, ten-week RAG publishing series.

**Working baseline:** all ten apps perform real retrieval on included synthetic data without keys or model downloads. The offline mode returns source excerpts, not an invented AI answer. Enable an installed local Ollama model for generation; optionally add Sentence Transformers for semantic retrieval and reranking.

## Campus Guide website — Python backend + Next.js frontend

The first demo, Campus Guide, is a student guide for a school: the owner adds
the school's documents and students ask questions on a chat page. A welcome
page with quick actions is written from the documents, answer instructions are
editable in Settings, and a "How it works" section shows each RAG layer
(retrieval, augmentation, generation) for any question. Its backend is Python
(FastAPI): PyMuPDF and RapidOCR extract text from pages and images,
python-docx reads Word files, FastEmbed and `rag_core`'s stemmed SQLite FTS5
index power hybrid retrieval, and the `openai` SDK streams DeepSeek answers
through AgentRouter with retries. Next.js renders the interface and proxies
`/api/*` to the backend. From the repository root:

```bash
cd demos/01-campus-desk
python3.11 -m venv .venv
.venv/bin/python -m pip install -e ../.. -r backend/requirements.txt
npm ci
npm run api    # Python backend on :8000
npm run dev    # frontend on :3000 (second terminal)
```

Without a model key it still retrieves and shows passages. See [setup, architecture and
deployment instructions](demos/01-campus-desk/WEB_README.md). Each demo's
frontend, backend, dependencies, and build configuration live inside that
demo's own folder.

## Python demos quick start

Python 3.11 or newer and SQLite with FTS5 are required. Run commands from the repository root.

```bash
python -m venv .venv
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -e '.[ui,test]'
python -m streamlit run demos/01-campus-desk/app.py --server.address 127.0.0.1
```

Zero-dependency CLI (works without installation when run from the repository root):

```bash
python -m rag_core.cli --config demos/01-campus-desk/config.json ask 'When does the library close?'
python -m rag_core.cli --config demos/01-campus-desk/config.json evaluate
```

## The ten demos

Each directory contains its own app, config, corpus, manifest, evaluation cases, README and a Codex prompt for the next iteration. The original roadmap describes a larger target than this first implementation; see [the feature matrix](docs/STATUS.md) before describing a feature as shipped.

| Saturday | Folder | Distinct workflow |
|---|---|---|
| 1 | `demos/01-campus-desk` | Handbook search and evidence-backed generation |
| 2 | `demos/02-study-companion` | Section/fixed chunking and contextual follow-up |
| 3 | `demos/03-manual-finder` | Device filtering; keyword/dense/hybrid retrieval |
| 4 | `demos/04-repo-guide` | File/line evidence and optional reranking |
| 5 | `demos/05-paper-compare` | Independent retrieval for each selected paper |
| 6 | `demos/06-policy-timeline` | Effective dates, gaps, overlap detection and version comparison |
| 7 | `demos/07-support-shelf` | Local test identities and tenant-scoped source access |
| 8 | `demos/08-parts-map` | Curated two-hop graph with evidence per edge |
| 9 | `demos/09-spec-reader` | Original synthetic pages, transcribed text and verified-cell arithmetic |
| 10 | `demos/10-field-notes-desk` | At most three searches with explicit stop reasons |

Run any folder separately:

```bash
python -m streamlit run demos/08-parts-map/app.py --server.address 127.0.0.1 --server.port 8508
```

Use a different port for each concurrently running app. Apps have independent in-memory indexes; there is no shared chat history or global answer cache. Restart or reindex after changing fixtures. Do not serve the Support Shelf identity simulator publicly.

## Optional local generation

Install Ollama separately, pull a model supported by your machine, and run its server. Choose the actual installed model name; the application never silently pulls a model or chooses a paid service.

```bash
export RAG_GENERATOR=ollama
export OLLAMA_MODEL='YOUR_INSTALLED_MODEL'
export OLLAMA_HOST='http://127.0.0.1:11434'
export RAG_TIMEOUT=30
python -m streamlit run demos/01-campus-desk/app.py --server.address 127.0.0.1
```

Environment variables are read on startup. `.env.example` documents them but no `.env` loader is included. In PowerShell use `$env:RAG_GENERATOR = 'ollama'` and equivalent assignments.

The adapter uses Ollama `/api/chat` with non-streaming JSON output. Citation IDs must belong to the retrieved context. Missing/unknown citations or provider failure return the sources with a visible error state. Valid IDs do **not** prove that every generated claim is supported; inspect answers manually. A model can still be influenced by hostile document text. No action tools are exposed.

## Optional semantic search and reranking

```bash
python -m pip install -e '.[semantic]'
export RAG_EMBEDDING_MODEL='sentence-transformers/all-MiniLM-L6-v2'
# Optional:
export RAG_RERANKER_MODEL='cross-encoder/ms-marco-MiniLM-L6-v2'
python -m rag_core.cli --config demos/03-manual-finder/config.json --mode hybrid ask 'E17' --device M1
```

These example model identifiers are configurable, not performance recommendations. Initial use downloads weights and may require significant disk space. Dense search uses cosine similarity; hybrid search uses reciprocal rank fusion with constant 60 and stable ID ties. Candidate vectors are computed per request in this small baseline, not stored in a production vector database. Models are never loaded with `trust_remote_code=True`.

## Special workflows

```bash
python -m rag_core.cli --config demos/05-paper-compare/config.json compare 'retrieval method' paper-a paper-b
python -m rag_core.cli --config demos/06-policy-timeline/config.json ask 'annual leave' --as-of 2025-12-31
python -m rag_core.cli --config demos/07-support-shelf/config.json ask 'returns window' --identity alice
python -m rag_core.cli --config demos/08-parts-map/config.json graph A R1
python -m rag_core.cli --config demos/09-spec-reader/config.json calculate A B
python -m rag_core.cli --config demos/10-field-notes-desk/config.json loop 'inspection PUMP-7'
```

The final demo defaults to a deterministic metadata-reference follower. It has an injectable planner interface, but **does not ship an LLM-driven planner**. Spec Reader uses manually transcribed page text, **not OCR or visual embeddings**. The graph is a small curated graph, **not Microsoft GraphRAG**.

## Index your own small Git repository

Repo Guide's supplied snapshot is synthetic. For an owned local repository, export an immutable commit snapshot:

```python
import json
from pathlib import Path
from rag_core.repository import git_documents

documents = git_documents('/absolute/path/to/your/repository', 'HEAD')
Path('demos/04-repo-guide/corpus.json').write_text(json.dumps(documents, indent=2))
```

Then reindex in the UI. The importer reads committed files with Git, never executes indexed code, skips environment files, generated folders and common secret patterns, and records the commit and line ranges. Its secret detector is heuristic: inspect the exported corpus yourself before sharing it. It uses bounded 40-line chunks, not a language-aware AST parser.

## Verification

```bash
python -m pytest -q
python scripts/evaluate_all.py
```

`evaluate_all.py` writes actual retrieval checks to `reports/retrieval.json`. The tests include all ten UI entry points if Streamlit is installed. See [verification notes](docs/VERIFICATION.md) for what was actually run and what remains unverified. No synthetic fixture score should be advertised as real-world answer accuracy.

## Layout

- `rag_core/core.py`: stable chunk metadata, FTS5, filtering, cosine ranking and rank fusion.
- `rag_core/pipeline.py`: retrieval, generation validation, follow-ups and policy/identity rules.
- `rag_core/providers.py`: optional Sentence Transformers and Ollama adapters.
- `rag_core/workflows.py`: comparisons, graph paths, calculations and bounded searches.
- `rag_core/study.py`: Study Companion parent-section expansion, one follow-up and verbatim explanations.
- `rag_core/repository.py`: read-only Git snapshot ingestion.
- `rag_core/ui.py`: shared UI, with each demo independently configured.
- `tests/`: core, security-boundary, repository and app smoke tests.

## Limits and next steps

This is a runnable learning repository, not ten production services. Included evaluation sets are deliberately small. There is no production authentication, file-upload API, PDF parser, OCR engine, persisted embedding store, answer cache, rate limiting or deployment automation. Follow each demo's Codex brief to expand it after measuring the baseline. Keep generated answers and build results out of public posts until you have run them yourself.

No software license has been chosen on your behalf. Add a license before inviting third-party reuse beyond ordinary repository viewing.
