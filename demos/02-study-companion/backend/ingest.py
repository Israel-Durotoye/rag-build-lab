"""Upload pipeline: extract → split into sections → chunk both ways → embed →
index, reporting each stage.

Every document is chunked twice, section-aware and fixed-length, so the same
question can be asked of both. The sample notes (``corpus.json``) arrive
already in sections and keep their section IDs.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from threading import Lock
from time import perf_counter
from typing import Callable

from rag_core.core import STOP, tokens
from rag_core.web.documents import DocumentError, slugify, validate_documents
from rag_core.web.embeddings import Embedder
from rag_core.web.extraction import extract
from rag_core.web.ocr import OcrEngine

from .sectioning import SECTION_MAX_WORDS, build_sections
from .settings import DEMO_DIR
from .store import CHUNKINGS, Workspace, chunk_record, embedding_text, summary

# PyMuPDF is not thread-safe, so extraction runs one file at a time.
EXTRACTION_LOCK = Lock()
INDEX_ENGINE = 'SQLite FTS5 (Porter stemmer), BM25 ranking'
SAMPLE_CORPUS = DEMO_DIR / 'corpus.json'
SAMPLE_QUESTIONS = DEMO_DIR / 'questions.json'


def _ms(start: float) -> int:
    return round((perf_counter() - start) * 1000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def vocabulary(texts: list[str]) -> dict:
    """Vocabulary facts shown on the Notes page."""
    words = [w for text in texts for w in tokens(text)]
    content = Counter(w for w in words if len(w) > 2 and not w.isdigit() and w not in STOP)
    return {'words': len(words), 'vocabulary': len(set(words)),
            'topTerms': [{'term': term, 'count': count} for term, count in content.most_common(14)]}


def _room(workspace: Workspace, doc_id: str, max_documents: int) -> None:
    if workspace.record(doc_id) is None and len(workspace.records()) >= max_documents:
        raise DocumentError(f'This workspace already holds {max_documents} sets of notes. Remove one to add another.')


def _embed(record: dict, workspace: Workspace, embedder: Embedder | None,
           progress: Callable[[int, int], None] | None = None) -> dict | None:
    """One matrix per chunking, or None when semantic search is off."""
    if embedder is None:
        return None
    chunked = {chunking: chunk_record(record, chunking, workspace.chunk_words) for chunking in CHUNKINGS}
    total = sum(len(chunks) for chunks in chunked.values())
    done = 0
    vectors = {}
    for chunking, chunks in chunked.items():
        offset = done
        vectors[chunking] = embedder.embed_documents(
            [embedding_text(c) for c in chunks],
            (lambda part, _total, offset=offset: progress(offset + part, total)) if progress else None)
        done += len(chunks)
    record['embeddings'] = {'model': embedder.name, 'dimensions': embedder.dimensions,
                            # The real first values of section 1's vector, shown as an example.
                            'sample': [round(float(x), 4) for x in vectors['section'][0][:6]]}
    return vectors


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

    doc_id = f"{slugify(extracted.name) or 'notes'}-{digest[:6]}"
    existing = workspace.record(doc_id)
    _room(workspace, doc_id, max_documents)

    emit({'type': 'progress', 'stage': 'sectioning'})
    started = perf_counter()
    sections, truncated = build_sections(extracted.blocks, extracted.name)
    if not sections:
        raise DocumentError('No readable text was found in this file.')
    timings['sectionMs'] = _ms(started)

    record = {
        'id': doc_id,
        'name': extracted.name,
        'format': extracted.format,
        'version': '1',
        'bytes': extracted.bytes,
        'sha256': digest,
        'addedAt': _now(),
        'truncated': truncated or extracted.truncated,
        'extraction': {
            'pageCount': extracted.page_count,
            'pages': extracted.pages,
            'blocks': len(extracted.blocks),
            'characters': sum(len(b.text) for b in extracted.blocks),
            'textPages': sum(1 for p in extracted.pages if p['method'] in {'text', 'text+ocr'}),
            'ocrPages': extracted.ocr_pages,
            'imageRegions': extracted.image_regions,
            'emptyPages': sum(1 for p in extracted.pages if p['method'] == 'empty'),
            'ocrFailed': extracted.ocr_failed,
            'ocrEngine': ocr.name if ocr is not None else None,
        },
        'sectioning': {'maxWords': SECTION_MAX_WORDS,
                       'headings': len({s.heading for s in sections}),
                       'splitHeadings': len({s.heading for s in sections if s.parts > 1})},
        'sections': [s.as_dict() for s in sections],
        'index': {'engine': INDEX_ENGINE, **vocabulary([s.text for s in sections])},
        'embeddings': None,
        'timings': timings,
        'overview': existing.get('overview') if existing and existing.get('sha256') == digest else None,
    }

    vectors = None
    if embedder is not None:
        started = perf_counter()

        def progress(done: int, total: int) -> None:
            if cancelled():
                raise DocumentError('Upload cancelled.')
            emit({'type': 'progress', 'stage': 'embedding', 'done': done, 'total': total})

        emit({'type': 'progress', 'stage': 'embedding', 'done': 0, 'total': 0})
        vectors = _embed(record, workspace, embedder, progress)
        timings['embedMs'] = _ms(started)

    emit({'type': 'progress', 'stage': 'indexing'})
    started = perf_counter()
    workspace.save(record, vectors)
    timings['indexMs'] = _ms(started)
    workspace.save(record, replace_vectors=False)
    emit({'type': 'done', 'document': summary(record)})
    return record


def ingest_sections(workspace: Workspace, documents: list[dict], embedder: Embedder | None, *,
                    fmt: str = 'sample', max_documents: int | None = None) -> list[dict]:
    """Add pre-sectioned documents as they are: sections keep their IDs,
    titles and locations."""
    records = []
    for doc in validate_documents(documents):
        if max_documents is not None:
            _room(workspace, doc['id'], max_documents)
        started = perf_counter()
        sections = [{'id': s['id'], 'title': s['title'], 'text': s['text'], 'location': s['location'],
                     'pages': None, 'words': len(s['text'].split()), 'ocr': False, 'heading': s['title'],
                     'part': 1, 'parts': 1} for s in doc['sections']]
        characters = sum(len(s['text']) for s in sections)
        record = {
            'id': doc['id'], 'name': doc['title'], 'format': fmt, 'version': doc['version'], 'bytes': 0,
            'sha256': hashlib.sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest(),
            'addedAt': _now(), 'truncated': False,
            'extraction': {'pageCount': 0, 'pages': [], 'blocks': len(sections), 'characters': characters,
                           'textPages': 0, 'ocrPages': 0, 'imageRegions': 0, 'emptyPages': 0,
                           'ocrFailed': False, 'ocrEngine': None},
            'sectioning': {'maxWords': None, 'headings': len(sections), 'splitHeadings': 0},
            'sections': sections,
            'index': {'engine': INDEX_ENGINE, **vocabulary([s['text'] for s in sections])},
            'embeddings': None, 'timings': {}, 'overview': None,
        }
        existing = workspace.record(record['id'])
        if existing and existing.get('sha256') == record['sha256']:
            record['overview'] = existing.get('overview')
        vectors = _embed(record, workspace, embedder)
        if vectors is not None:
            record['timings']['embedMs'] = _ms(started)
        workspace.save(record, vectors)
        records.append(record)
    return records


def sample_documents() -> list[dict]:
    return json.loads(SAMPLE_CORPUS.read_text())


def sample_questions() -> list[dict]:
    return json.loads(SAMPLE_QUESTIONS.read_text())


def sample_info(workspace: Workspace) -> dict:
    """The bundled synthetic notes and their fixed question set."""
    documents = sample_documents()
    ids = [d['id'] for d in documents]
    return {'documents': [{'id': d['id'], 'title': d['title'], 'sections': len(d['sections'])} for d in documents],
            'loaded': all(workspace.record(i) is not None and workspace.record(i)['format'] == 'sample' for i in ids),
            'questions': sample_questions(),
            'provenance': 'Original synthetic control-systems notes written for RAG Build Lab.'}
