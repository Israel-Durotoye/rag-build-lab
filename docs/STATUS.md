# Implemented baseline versus planned expansion

All ten directories run independently against the same core. The Codex briefs preserve the larger roadmap targets; they are instructions for future iterations, not release claims.

Campus Desk also has a website, **Campus Guide**, inside `demos/01-campus-desk`: a Python (FastAPI)
backend with a Next.js frontend. Visitors upload their own PDF or Word file; the
backend extracts it (PyMuPDF, RapidOCR for scans and images, python-docx),
chunks and embeds it (FastEmbed), retrieves with hybrid search (stemmed BM25 via
`rag_core` plus embeddings, fused with RRF), and streams cited answers from
DeepSeek via AgentRouter with retries. Its welcome page and quick actions are
written by the model from the documents, answer instructions are editable in the
interface, and a "How it works" section shows each layer's trace. It runs the same seven evaluation cases through its API.
See [the web migration guide](../demos/01-campus-desk/WEB_README.md).

Study Companion has a website too, inside `demos/02-study-companion`, built the
same way and sharing Campus Guide's extraction, embedding and retrieval code
through `rag_core/web`. Students add their own notes or load the sample notes.
Every set of notes is divided into sections and chunked two ways
(section-aware, and fixed-length windows); a small match can grow to its whole
section within a word budget; replies are streamed with checked citations and
the notes' own caveats quoted beside them; follow-ups carry earlier questions
and never earlier answers. A Compare page runs one question, or a set, against
both chunkings without declaring a winner, and a Practise page writes quizzes
and flashcards whose quotes are checked against the notes. Nothing has been
deployed. See [its guide](../demos/02-study-companion/WEB_README.md) and
[what was run](../demos/02-study-companion/WEB_RUN_RESULTS.md).

The other eight demos retain their Python/Streamlit interfaces, as do these two
alongside their websites.

| Demo | Implemented now | Still to build or measure |
|---|---|---|
| Campus Desk | Synthetic handbook viewer, side-by-side evidence, metadata citation labels, optional generation, seven fixed questions, answer-support checklist and 75-second script | Held-out paraphrase/near-miss evaluation; robust semantic answerability; live model verification |
| Study Companion | Own UI with explanation (verbatim offline, optional model), supporting sections and original source; fixed/section chunking; parent-section expansion under a 250-word budget; one question-only follow-up per topic; reset; saved section vs fixed runs over eight questions (no winner declared); manual exception checklist. **Website:** uploads (PDF, Word, text, Markdown) and sample notes; sections; both chunkings indexed per workspace; hybrid retrieval; expansion within an adjustable budget; streamed explanations at three levels with checked citations; caveats quoted by rule; follow-ups by question only; chunking lab and question sets; quizzes, flashcards and recall cards with quote checks; per-step trace pages; live model check of the exception on five replies (all kept it) | Deployment; held-out/paraphrase questions; semantic answerability (matches by meaning alone are flagged, not judged); answer-quality evaluation; long documents; scanned notes through this site |
| Manual Finder | Device filter, mandatory device choice, optional dense/hybrid/RRF | Larger identifier/paraphrase evaluation |
| Repo Guide | Snapshot fixture, commit-pinned Git importer, line citations, optional reranker | AST chunking, real model comparison and latency experiment |
| Paper Compare | Separate retrieval per selected document; unsupported field can yield no match | Structured claim-by-claim comparison, 20 development questions and held-out set |
| Policy Timeline | Half-open effective dates, gaps, overlapping version detection, version comparison, atomic reindex/delete API | Richer policy-family handling, guided update/delete UI |
| Support Shelf | Server-side test grants, scoped retrieval and direct preview, revocation API | Real authentication and threat review; model injection resistance is unproven |
| Parts Map | Curated evidence-linked edges, two-hop limit, missing-edge/conflict checks | Larger graph, ambiguity handling by display name, comparative experiment |
| Spec Reader | Synthetic SVG pages, manual transcription, verified cells, Decimal arithmetic, unit/missing-input checks | OCR or visual retrieval and measured extraction error |
| Field Notes Desk | Bounded controller, three-call cap, repeated-query stop, tool/argument checks, evidence trace | LLM planner, held-out quality evaluation, latency/cost study |

Core: SQLite persistence is available via `--db`; default UI indexes are in memory. The CLI initializes the selected corpus at startup. `Index.replace()` and `Index.delete()` change the corpus revision. No answer cache is implemented, so there is no cached response to invalidate. UI conversation results are reset on reindex and identity change.

Offline search abstains when no keyword matches exist. That is not a calibrated answerability model: a keyword match can be irrelevant, and paraphrases can be missed. Dense mode can return weak matches. Inspect source support before drawing conclusions.
