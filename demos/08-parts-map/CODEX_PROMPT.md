# Parts Map next iteration

Inspect the existing implementation and docs/STATUS.md first. Reuse rag_core, preserve the working offline baseline, and add tests for changes. The brief below is the target, not a claim that every feature is already shipped.

Inspect the current repository and its instructions first. Implement the scoped prototype below, not just a plan. Reuse compatible code without overwriting unrelated work. If starting fresh, use Python with Streamlit for the local UI, SQLite for source metadata and FTS5 keyword search, and a configurable embedding adapter for semantic retrieval. Use current official package documentation and record tested dependency versions. Keep model/provider choices configurable; do not invent API methods or hard-code a paid model.

Use synthetic or explicitly permitted sample data. Store document ID, chunk ID, source location, corpus version and content hash. Never commit keys or private data. Implement a real retrieval path. If no generation credentials are available, provide a clearly labelled source-search mode rather than pretend that canned text is an LLM response. Test doubles are for automated tests only. Include an .env.example, setup commands, sample questions and a README stating limitations. Run meaningful tests and report actual results, failures and commands. Do not fabricate benchmarks. Run locally; provide deployment instructions without publishing or creating paid resources.

Build Parts Map as a curated graph-assisted RAG prototype over a fictional parts catalogue. Use a small adjacency structure or a lightweight graph library, not a new graph service. Store entity IDs, relation types and source passage IDs for every edge. Keep duplicate display names distinguishable by stable identifiers.

Implement a bounded maximum-two-hop evidence path for relationship questions and retrieve the underlying passages before generating an explanation. An unsupported edge must be returned as an unresolved gap; do not infer real compatibility. Include passage-only retrieval as a baseline over the same text. Clearly state that the curated graph contains additional labelled structure and that this is not Microsoft's full GraphRAG algorithm.

Test a complete two-hop path, a missing edge, a contradictory edge and an ambiguous entity. Save source paths and measured timings for both routes. The UI must let the reader open the evidence for each link. Keep real component selection and equipment control outside scope.
