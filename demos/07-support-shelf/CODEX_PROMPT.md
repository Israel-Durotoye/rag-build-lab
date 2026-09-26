# Support Shelf next iteration

Inspect the existing implementation and docs/STATUS.md first. Reuse rag_core, preserve the working offline baseline, and add tests for changes. The brief below is the target, not a claim that every feature is already shipped.

Inspect the current repository and its instructions first. Implement the scoped prototype below, not just a plan. Reuse compatible code without overwriting unrelated work. If starting fresh, use Python with Streamlit for the local UI, SQLite for source metadata and FTS5 keyword search, and a configurable embedding adapter for semantic retrieval. Use current official package documentation and record tested dependency versions. Keep model/provider choices configurable; do not invent API methods or hard-code a paid model.

Use synthetic or explicitly permitted sample data. Store document ID, chunk ID, source location, corpus version and content hash. Never commit keys or private data. Implement a real retrieval path. If no generation credentials are available, provide a clearly labelled source-search mode rather than pretend that canned text is an LLM response. Test doubles are for automated tests only. Include an .env.example, setup commands, sample questions and a README stating limitations. Run meaningful tests and report actual results, failures and commands. Do not fabricate benchmarks. Run locally; provide deployment instructions without publishing or creating paid resources.

Build Support Shelf as a local read-only RAG demonstration with two synthetic tenants. Use server-controlled test identity fixtures mapped to tenant permissions. Mark any local account switcher as a simulation and disable it for a public deployment. Never accept an arbitrary client-supplied tenant_id as proof of authorisation.

Enforce access before retrieved text reaches context. Protect source previews, exports and cached answers with the same authorisation rule. Scope caches by identity or equivalent permission set and corpus version, and test revocation. Treat every document as untrusted data. Add a harmless prompt-injection fixture asking for a task change, but provide no privileged secrets or external-action tools to the model.

Write application tests for cross-tenant search, direct chunk access, cache isolation and revocation, plus an observable injection test. Report actual outcomes without declaring the system secure or injection-proof. Keep real authentication and private uploads out of the required scope; document what would be needed before either is enabled.
