# Implemented baseline versus planned expansion

All ten directories run independently against the same core. The Codex briefs preserve the larger roadmap targets; they are instructions for future iterations, not release claims.

| Demo | Implemented now | Still to build or measure |
|---|---|---|
| Campus Desk | Synthetic handbook, retrieval, inspectable evidence, optional generation, absent-term check | Larger labelled question set; robust semantic answerability |
| Study Companion | Fixed/section chunking, original-question follow-up, reset | Parent-section expansion, controlled chunking comparison |
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
