# Spec Reader next iteration

Inspect the existing implementation and docs/STATUS.md first. Reuse rag_core, preserve the working offline baseline, and add tests for changes. The brief below is the target, not a claim that every feature is already shipped.

Inspect the current repository and its instructions first. Implement the scoped prototype below, not just a plan. Reuse compatible code without overwriting unrelated work. If starting fresh, use Python with Streamlit for the local UI, SQLite for source metadata and FTS5 keyword search, and a configurable embedding adapter for semantic retrieval. Use current official package documentation and record tested dependency versions. Keep model/provider choices configurable; do not invent API methods or hard-code a paid model.

Use synthetic or explicitly permitted sample data. Store document ID, chunk ID, source location, corpus version and content hash. Never commit keys or private data. Implement a real retrieval path. If no generation credentials are available, provide a clearly labelled source-search mode rather than pretend that canned text is an LLM response. Test doubles are for automated tests only. Include an .env.example, setup commands, sample questions and a README stating limitations. Run meaningful tests and report actual results, failures and commands. Do not fabricate benchmarks. Run locally; provide deployment instructions without publishing or creating paid resources.

Build Spec Reader using synthetic page images with known diagram labels and table values. Preserve page IDs and, where available, bounding regions. Implement a documented retrieval route: use visual embeddings only if supported by the environment, otherwise provide a clearly labelled OCR-assisted text baseline. Do not claim a visual-embedding system when only OCR is used.

Keep original images inspectable beside the answer. Load manually validated table records with source page, row, column, value and unit. Implement one allowlisted deterministic calculation, such as a comparison of two fictional capacities in the same supported unit. Do not execute arbitrary model-generated code or guess missing inputs. Display the selected cells, formula and result.

Test diagram lookup, table lookup, correct arithmetic, unsupported units, a missing value and the intentionally unclear region. Report extraction/retrieval and calculation errors separately. Document hardware requirements and fallback limitations. Include a short demo showing the evidence before the number, and do not present the tool as a real engineering safety assessment.
