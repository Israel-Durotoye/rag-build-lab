# Architecture

A demo configuration selects a corpus and a workflow. Ingestion turns sections into chunks with stable identifiers, content hashes, versions and locations. SQLite stores metadata and an FTS5 index. Each request resolves its permitted tenant set and metadata/date filters before evidence reaches ranking output or generation.

Keyword retrieval uses FTS5 BM25 ordering. An optional Sentence Transformers adapter encodes candidates and the query. Hybrid mode fuses ranked IDs with reciprocal rank fusion. An optional cross-encoder reranks the first twelve candidates (or the requested count if larger).

The pipeline either returns source excerpts or sends a bounded top-k selection to an explicitly configured Ollama model. Structured responses require a boolean insufficient flag, a string answer and a list of citation IDs. The validator rejects unknown IDs and uncited answers. This is structural validation, not entailment verification.

Special workflows are small functions on this same pipeline. Paper comparison runs separate retrievals. Policy selection uses effective dates with an exclusive end date. Graph traversal requires an existing source for every curated edge. Arithmetic accepts known verified cells and matching allowlisted units. The final controller validates the tool name and arguments before each search and cannot call external action tools.

Trust boundary: the tenant simulator is not authentication. Only use synthetic data locally. Source text is untrusted even if retrieved. No generated code is executed. Provider endpoints and model names come from server environment variables, not documents or UI requests.

No retry loop, answer cache or background ingestion service is present. Provider requests have a finite timeout and fall back to source-search mode. The tiny fixture design allows synchronous, inspectable execution; larger corpora need batching, embedding persistence and measured resource budgets.
