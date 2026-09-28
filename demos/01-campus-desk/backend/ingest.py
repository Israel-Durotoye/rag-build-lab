"""Upload pipeline: extract → chunk → embed → index, reporting each stage.

The finished record also "elaborates" the document for the interface: how
each page was read, how the text was chunked, the index vocabulary, the
embedding model and how long every stage took.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from datetime import datetime, timezone
from threading import Lock
from time import perf_counter
from typing import Callable

from rag_core.core import STOP, tokens

from . import chunking
from .documents import LIMITS, DocumentError, slugify, validate_documents
from .embeddings import Embedder
from .extraction import extract
from .ocr import OcrEngine
from .store import Workspace, summary

# PyMuPDF is not thread-safe, so extraction runs one file at a time.
EXTRACTION_LOCK = Lock()


def _ms(start: float) -> int:
    return round((perf_counter() - start) * 1000)


def profile(chunks: list[chunking.Chunk]) -> dict:
    """Vocabulary facts shown on the Documents tab."""
    words = [w for c in chunks for w in tokens(c.text)]
    content = Counter(w for w in words if len(w) > 2 and not w.isdigit() and w not in STOP)
    return {'words': len(words), 'vocabulary': len(set(words)),
            'topTerms': [{'term': term, 'count': count} for term, count in content.most_common(14)]}


def ingest(data: bytes, filename: str, workspace: Workspace, *, max_documents: int, ocr: OcrEngine | None,
           embedder: Embedder | None, emit: Callable[[dict], None], cancelled: Callable[[], bool]) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    timings = {}

    started = perf_counter()
    with EXTRACTION_LOCK:
        extracted = None
        for event in extract(data, filename, ocr):
            if cancelled():
                raise DocumentError('Upload cancelled.')
            if event['type'] == 'extracted':
                extracted = event['result']
            else:
                emit(event)
    timings['extractMs'] = _ms(started)

    doc_id = f"{slugify(extracted.name) or 'document'}-{digest[:6]}"
    existing = workspace.record(doc_id)
    if existing is None and len(workspace.records()) >= max_documents:
        raise DocumentError(f'This workspace already holds {max_documents} documents. Remove one to add another.')

    emit({'type': 'progress', 'stage': 'chunking'})
    started = perf_counter()
    chunks, truncated = chunking.chunk_blocks(extracted.blocks, extracted.name)
    if not chunks:
        raise DocumentError('No readable text was found in this file.')
    timings['chunkMs'] = _ms(started)

    vectors = None
    if embedder is not None:
        started = perf_counter()

        def progress(done: int, total: int) -> None:
            if cancelled():
                raise DocumentError('Upload cancelled.')
            emit({'type': 'progress', 'stage': 'embedding', 'done': done, 'total': total})

        emit({'type': 'progress', 'stage': 'embedding', 'done': 0, 'total': len(chunks)})
        vectors = embedder.embed_documents([f'{c.title}\n{c.text}' for c in chunks], progress)
        timings['embedMs'] = _ms(started)

    emit({'type': 'progress', 'stage': 'indexing'})
    started = perf_counter()
    sizes = [c.chars for c in chunks]
    characters = sum(len(b.text) for b in extracted.blocks)
    record = {
        'id': doc_id,
        'name': extracted.name,
        'format': extracted.format,
        'bytes': extracted.bytes,
        'sha256': digest,
        'addedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'truncated': truncated or extracted.truncated,
        'extraction': {
            'pageCount': extracted.page_count,
            'pages': extracted.pages,
            'blocks': len(extracted.blocks),
            'characters': characters,
            'textPages': sum(1 for p in extracted.pages if p['method'] in {'text', 'text+ocr'}),
            'ocrPages': extracted.ocr_pages,
            'imageRegions': extracted.image_regions,
            'emptyPages': sum(1 for p in extracted.pages if p['method'] == 'empty'),
            'ocrFailed': extracted.ocr_failed,
            'ocrEngine': ocr.name if ocr is not None else None,
        },
        'chunking': {
            'target': chunking.TARGET, 'maximum': chunking.MAXIMUM, 'minimum': chunking.MINIMUM,
            'overlap': f'last paragraph if ≤ {chunking.OVERLAP_MAX} characters',
            'count': len(chunks), 'averageChars': round(sum(sizes) / len(sizes)),
            'minChars': min(sizes), 'maxChars': max(sizes),
            'limit': LIMITS['chunks_per_document'],
        },
        'index': {'engine': 'SQLite FTS5 (Porter stemmer), BM25 ranking', **profile(chunks)},
        'embeddings': {'model': embedder.name, 'dimensions': embedder.dimensions,
                       # The real first values of chunk 1's vector, shown as an example.
                       'sample': [round(float(x), 4) for x in vectors[0][:6]]} if embedder is not None else None,
        'timings': timings,
        'chunks': [c.as_dict() for c in chunks],
        'overview': existing.get('overview') if existing and existing.get('sha256') == digest else None,
    }
    workspace.save(record, vectors)
    timings['indexMs'] = _ms(started)
    workspace.save(record, replace_vectors=False)
    emit({'type': 'done', 'document': summary(record)})
    return record


def ingest_sections(workspace: Workspace, documents: list[dict], embedder: Embedder | None) -> list[dict]:
    """Add pre-sectioned documents (such as the fixture corpus.json) as they
    are: each section becomes one chunk and keeps its ID and location."""
    records = []
    for doc in validate_documents(documents):
        sections = doc['sections']
        chunks = [chunking.Chunk(s['id'], s['title'], s['text'], s['location'], None, False) for s in sections]
        vectors = embedder.embed_documents([f'{c.title}\n{c.text}' for c in chunks]) if embedder else None
        sizes = [c.chars for c in chunks]
        record = {
            'id': doc['id'], 'name': doc['title'], 'format': 'sections', 'bytes': 0, 'sha256': None,
            'addedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'truncated': False,
            'extraction': {'pageCount': 0, 'pages': [], 'blocks': len(chunks), 'characters': sum(sizes),
                           'textPages': 0, 'ocrPages': 0, 'imageRegions': 0, 'emptyPages': 0,
                           'ocrFailed': False, 'ocrEngine': None},
            'chunking': {'target': None, 'maximum': None, 'minimum': None, 'overlap': 'none (pre-sectioned)',
                         'count': len(chunks), 'averageChars': round(sum(sizes) / len(sizes)),
                         'minChars': min(sizes), 'maxChars': max(sizes), 'limit': LIMITS['chunks_per_document']},
            'index': {'engine': 'SQLite FTS5 (Porter stemmer), BM25 ranking', **profile(chunks)},
            'embeddings': {'model': embedder.name, 'dimensions': embedder.dimensions} if embedder else None,
            'timings': {}, 'chunks': [c.as_dict() for c in chunks], 'overview': None,
        }
        workspace.save(record, vectors)
        records.append(record)
    return records
