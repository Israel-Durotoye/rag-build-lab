"""Building blocks shared by the web demos' Python backends.

Each website keeps its own application code in ``demos/<demo>/backend`` and
imports the parts every one of them needs from here:

    documents   limits, IDs, heading detection, pre-sectioned document checks
    extraction  PDF, Word and text files into ordered text blocks (with OCR)
    ocr         RapidOCR engine, loaded once
    embeddings  FastEmbed sentence embeddings, loaded once
    retrieval   keyword, semantic and hybrid (RRF) retrieval with a full trace
    answers     citation checks, follow-up rewriting, JSON replies
    http        FastAPI helpers: NDJSON streaming and bounded JSON bodies

Nothing here is imported by ``rag_core`` itself, so the zero-dependency core
and CLI still run without these packages. Install them from a demo's
``backend/requirements.txt``.
"""
