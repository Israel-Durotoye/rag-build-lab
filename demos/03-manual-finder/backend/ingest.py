"""Getting manuals into a workspace: read → sections and units → models →
codes → embeddings → index, reporting each stage.

Uploads arrive as files; the sample library (``corpus.json``, built by
``library/build_corpus.py``) arrives already split into units, each tagged
with its models. Either way every unit records the models and revisions it
applies to, and every table row and code-naming heading feeds the code index.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from threading import Lock
from time import perf_counter
from typing import Callable

from rag_core.web.documents import DocumentError, slugify, validate_documents
from rag_core.web.embeddings import Embedder
from rag_core.web.extraction import extract
from rag_core.web.ocr import OcrEngine

from . import identifiers
from .sectioning import build_sections
from .settings import DEMO_DIR
from .store import Workspace, chunk_id, content_key, embedding_text, summary
from .variants import Registry, squash, suggest, tag, validate_models

# PyMuPDF is not thread-safe, so extraction runs one file at a time.
EXTRACTION_LOCK = Lock()
SAMPLE_CORPUS = DEMO_DIR / 'corpus.json'
SAMPLE_MODELS = DEMO_DIR / 'library' / 'models.json'
SAMPLE_QUERIES = DEMO_DIR / 'queries.json'


def _ms(start: float) -> int:
    return round((perf_counter() - start) * 1000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _room(workspace: Workspace, doc_id: str, max_documents: int) -> None:
    if workspace.record(doc_id) is None and len(workspace.records()) >= max_documents:
        raise DocumentError(f'This workspace already holds {max_documents} manuals. Remove one to add another.')


# ------------------------------------------------------------ models and codes

def model_names(record: dict) -> list[str]:
    """Every name of every model and family the manual defines."""
    names = []
    for model in record.get('modelDefs', []):
        names.extend([model['name'], model.get('short') or '', *model.get('aliases', [])])
        for revision in model.get('revisions', []):
            names.extend([revision['label'], *revision.get('aliases', [])])
    for family in record.get('families', []):
        names.extend([family['name'], *family.get('aliases', [])])
    return [n for n in names if n]


def tag_units(record: dict) -> None:
    """Decide, for every unit, the models and revisions it applies to (see
    variants.tag). Units of the sample library keep the tags they were built
    with."""
    registry = Registry.from_lists(record.get('modelDefs', []), record.get('families', []),
                                   record.get('outside', []))
    scope = {m['id']: None for m in record.get('modelDefs', [])}
    sections = {s['id']: s for s in record['sections']}
    rows: list[tuple[dict, dict[str, str | None]]] = []
    for unit in record['units']:
        section = sections.get(unit['sectionId'])
        headings = list(section['path']) if section else [record['name']]
        # A table row is judged by its row; its header names columns, not models.
        text = unit['text'].split('\n', 1)[1] if unit['kind'] == 'row' and '\n' in unit['text'] else unit['text']
        found = tag(text, headings, registry, scope)
        if unit['kind'] == 'row' and unit.get('header') and found['source'] != 'text':
            # A table with one column per model ("| | Raspberry Pi 2B | Raspberry
            # Pi 3B |"): its rows apply to the models its header names.
            columns = tag(unit['header'], [], registry, scope)
            if columns['source'] == 'text' and columns['models']:
                found = {**columns, 'source': 'header'}
        unit['models'] = found['models']
        unit['revisions'] = found['revisions']
        # How the tag was decided: from the passage's own text, from its
        # table's header, from a heading above it, or from the document as a
        # whole (shared).
        unit['tag'] = found['source']
        if unit['kind'] == 'row' and unit.get('header') and found['models']:
            said = row_revision(unit, text, registry)
            if said:
                rows.append((unit, said))
    # A "Revision" column narrows a row to the revision it names ("a01041 |
    # 2B | 1.1" is the 2B's v1.1). Where the column holds the model's own
    # revisions (a row of the table names one), a row naming another ("1.0")
    # is none of them: it applies to the model only when no revision is
    # chosen. Where it never does (the 3B's board revisions 1.2 and 1.3, while
    # the library tells the 3B's SoCs apart) it says nothing about them.
    axis = {(unit['header'], m) for unit, said in rows for m, revision in said.items() if revision}
    for unit, said in rows:
        for model_id, revision in said.items():
            if revision:
                unit['revisions'][model_id] = [revision]
            elif (unit['header'], model_id) in axis:
                unit['revisions'][model_id] = []


REVISION_COLUMNS = {'revision', 'rev', 'rev.', 'version', 'board revision'}


def row_revision(unit: dict, row: str, registry: Registry) -> dict[str, str | None] | None:
    """What a "Revision" column says about a row: for each of its models that
    has revisions, the one the cell names, or None when it names none of them.
    None when the table has no such column."""
    heads = [h.strip().lower() for h in unit['header'].split('|')]
    cells = [c.strip() for c in row.split('|')]
    column = next((i for i, h in enumerate(heads) if h in REVISION_COLUMNS), None)
    if column is None or column >= len(cells) or not cells[column]:
        return None
    value = squash(cells[column]).lstrip('v')
    said: dict[str, str | None] = {}
    for model_id in unit['models']:
        revisions = (registry.models.get(model_id) or {}).get('revisions', [])
        if revisions:
            said[model_id] = next((r['id'] for r in revisions
                                   if any(squash(label).removeprefix('rev').removeprefix('v') == value
                                          for label in [r['label'], *r.get('aliases', [])])), None)
    return said


def index_codes(record: dict) -> None:
    """The manual's code entries: every identifier in a table row (or named
    by a section heading), with the row or the section's first passage as its
    meaning. Also records on each unit the codes it defines."""
    skip = model_names(record)
    sections = {s['id']: s for s in record['sections']}
    registry = Registry.from_lists(record.get('modelDefs', []), record.get('families', []),
                                   record.get('outside', []))
    scope = {m['id']: None for m in record.get('modelDefs', [])}
    entries: list[dict] = []
    seen: set[tuple[str, str]] = set()
    by_header: dict[str, list[list[str] | None] | None] = {}

    def model_columns(header: str) -> list[list[str] | None] | None:
        """For a table with one column per model, the models each column
        names (None for a column such as "Feature"); otherwise None."""
        if header not in by_header:
            columns = []
            for cell in header.split('|'):
                found = tag(cell, [], registry, scope) if cell.strip() else None
                columns.append(found['models'] if found and found['source'] == 'text' else None)
            by_header[header] = columns if sum(1 for c in columns if c) >= 2 else None
        return by_header[header]

    def add(code: identifiers.Code, unit: dict, meaning: str, models: list[str] | None = None) -> None:
        if (code.code, unit['id']) in seen:
            return
        seen.add((code.code, unit['id']))
        unit.setdefault('codes', []).append(code.code)
        entries.append({'code': code.code, 'display': code.display, 'scheme': code.scheme, 'unitId': unit['id'],
                        'chunkId': chunk_id(record['id'], unit['id']),
                        'models': unit['models'] if models is None else models, 'meaning': meaning})

    for unit in record['units']:
        unit['codes'] = []
    first_unit: dict[str, dict] = {}
    for unit in record['units']:
        first_unit.setdefault(unit['sectionId'], unit)
        if unit['kind'] == 'row' and unit.get('header'):
            row = unit['text'].split('\n', 1)[1] if '\n' in unit['text'] else unit['text']
            section = sections.get(unit['sectionId'])
            columns = model_columns(unit['header'])
            for code, at in identifiers.row_code_cells(row, unit['header'], skip, section['path'] if section else ()):
                # In a table with one column per model, a code read only from
                # model columns is that model's ("ESP32" under "UNO R4 WiFi"),
                # not every model of the row.
                owners = None
                if columns and unit['models'] and all(i < len(columns) and columns[i] for i in at):
                    named = {m for i in at for m in columns[i]}
                    owners = [m for m in unit['models'] if m in named] or None
                add(code, unit, row, owners)
    for section_id, unit in first_unit.items():
        section = sections.get(section_id)
        if section and unit['kind'] != 'row':
            for code in identifiers.heading_codes(section['title'], skip):
                add(code, unit, unit['text'])
    record['codes'] = entries


def finish(record: dict) -> None:
    """Fill in what follows from the units and models."""
    record['models'] = [m['id'] for m in record.get('modelDefs', [])]
    index_codes(record)


def apply_models(record: dict, models, families) -> dict:
    """Replace a manual's models (from the tagging step), re-tag its units and
    re-index its codes. Raises VariantError for an invalid list."""
    clean_models, clean_families = validate_models(models, families)
    record = {**record, 'modelDefs': clean_models, 'families': clean_families, 'modelsConfirmed': True,
              'units': [dict(u) for u in record['units']]}
    tag_units(record)
    finish(record)
    return record


# ------------------------------------------------------------ embeddings

def embed(record: dict, workspace: Workspace, embedder: Embedder | None,
          progress: Callable[[int, int], None] | None = None):
    """One vector per unit; None when semantic search is off. The sample
    library's vectors are cached for every workspace on the server. An
    upload's never are: a shared cache would let one browser tell, by how fast
    an upload finished, that another had uploaded the same file."""
    if embedder is None:
        record['embeddings'] = None
        return None
    shared = record['format'] == 'sample'
    key = content_key(record, embedder.name)
    vectors = workspace.cached_vectors(key) if shared else None
    if vectors is None or len(vectors) != len(record['units']):
        sections = {s['id']: s for s in record['sections']}
        vectors = embedder.embed_documents([embedding_text(record, u, sections) for u in record['units']], progress)
        if shared:
            workspace.cache_vectors(key, vectors)
    elif progress:
        progress(len(record['units']), len(record['units']))
    record['embeddings'] = {'model': embedder.name, 'dimensions': int(vectors.shape[1]) if len(vectors) else 0}
    return vectors


# ------------------------------------------------------------ uploads

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

    doc_id = f"{slugify(extracted.name) or 'manual'}-{digest[:6]}"
    existing = workspace.record(doc_id)
    _room(workspace, doc_id, max_documents)

    emit({'type': 'progress', 'stage': 'sectioning'})
    started = perf_counter()
    sections, truncated = build_sections(extracted.blocks, extracted.name)
    if not sections:
        raise DocumentError('No readable text was found in this file.')
    timings['sectionMs'] = _ms(started)

    emit({'type': 'progress', 'stage': 'tagging'})
    started = perf_counter()
    units = [u for s in sections for u in s.units]
    record = {
        'id': doc_id,
        'name': extracted.name,
        'format': extracted.format,
        'version': digest[:12],
        'bytes': extracted.bytes,
        'sha256': digest,
        'addedAt': _now(),
        'truncated': truncated or extracted.truncated,
        'source': None,
        # Kept when the same file is uploaded again.
        'modelDefs': existing.get('modelDefs', []) if existing else [],
        'families': existing.get('families', []) if existing else [],
        'modelsConfirmed': existing.get('modelsConfirmed', False) if existing else False,
        'suggestedModels': [],
        'extraction': {
            'pageCount': extracted.page_count,
            'ocrPages': extracted.ocr_pages,
            'characters': sum(len(b.text) for b in extracted.blocks),
            'ocrEngine': ocr.name if ocr is not None else None,
        },
        'sections': [{'id': s.id, 'title': s.title, 'path': s.path, 'location': s.location,
                      'unitIds': [u.id for u in s.units]} for s in sections],
        'units': [{'id': u.id, 'sectionId': u.section_id, 'text': u.text, 'location': u.location, 'kind': u.kind,
                   'header': u.header, 'pages': u.pages, 'ocr': u.ocr, 'models': None, 'revisions': {}, 'codes': []}
                  for u in units],
        'embeddings': None,
        'timings': timings,
    }
    tag_units(record)
    finish(record)
    # Suggestions leave out the manual's own codes (pins such as D13 are not models).
    record['suggestedModels'] = suggest([u.text for u in units] + [s.title for s in sections],
                                        exclude={entry['code'] for entry in record['codes']})
    timings['tagMs'] = _ms(started)

    vectors = None
    if embedder is not None:
        started = perf_counter()

        def progress(done: int, total: int) -> None:
            if cancelled():
                raise DocumentError('Upload cancelled.')
            emit({'type': 'progress', 'stage': 'embedding', 'done': done, 'total': total})

        emit({'type': 'progress', 'stage': 'embedding', 'done': 0, 'total': len(units)})
        vectors = embed(record, workspace, embedder, progress)
        timings['embedMs'] = _ms(started)

    emit({'type': 'progress', 'stage': 'indexing'})
    started = perf_counter()
    workspace.save(record, vectors)
    timings['indexMs'] = _ms(started)
    workspace.save(record, replace_vectors=False)
    emit({'type': 'done', 'document': summary(record)})
    return record


# ------------------------------------------------------------ the sample library

def sample_models() -> dict:
    return json.loads(SAMPLE_MODELS.read_text())


def sample_documents() -> list[dict]:
    return json.loads(SAMPLE_CORPUS.read_text())


def sample_queries() -> list[dict]:
    return json.loads(SAMPLE_QUERIES.read_text()) if SAMPLE_QUERIES.exists() else []


def sample_record(doc: dict, registry: dict) -> dict:
    """A corpus.json document (units as rag_core sections, tags in their
    metadata) as a workspace record."""
    meta = doc['metadata']
    covered = list(meta.get('models', []))
    models = [m for m in registry['models'] if m['id'] in covered]
    families = [{**f, 'members': [m for m in f['members'] if m in covered]} for f in registry.get('families', [])
                if any(m in covered for m in f['members'])]
    sections: dict[str, dict] = {}
    units = []
    for entry in doc['sections']:
        unit_meta = entry.get('metadata', {})
        parent = unit_meta.get('parent', entry['id'])
        section = sections.get(parent)
        if section is None:
            section = sections[parent] = {'id': parent, 'title': entry['title'],
                                          'path': unit_meta.get('path', [doc['title'], entry['title']]),
                                          'location': entry['location'], 'unitIds': []}
        section['unitIds'].append(entry['id'])
        shared = 'device' not in unit_meta or unit_meta.get('shared')
        units.append({'id': entry['id'], 'sectionId': parent, 'text': entry['text'], 'location': entry['location'],
                      'kind': unit_meta.get('kind', 'paragraph'), 'header': unit_meta.get('header'),
                      'pages': None, 'ocr': False, 'models': None if shared else list(unit_meta['device']),
                      'revisions': dict(unit_meta.get('revisions', {})), 'codes': [],
                      'tag': unit_meta.get('tag'), 'tagReason': unit_meta.get('tagReason')})
    record = {
        'id': doc['id'], 'name': doc['title'], 'format': 'sample', 'version': doc.get('version', '1'), 'bytes': 0,
        'sha256': hashlib.sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest(), 'addedAt': _now(),
        'truncated': False,
        'source': {k: meta.get(k, '') for k in ('publisher', 'url', 'source', 'licence', 'licenceUrl', 'retrieved')},
        'modelDefs': models, 'families': families, 'modelsConfirmed': True, 'suggestedModels': [],
        'outside': list(registry.get('outside', [])), 'extraction': None,
        'sections': list(sections.values()), 'units': units, 'embeddings': None, 'timings': {},
    }
    finish(record)
    return record


def load_sample(workspace: Workspace, embedder: Embedder | None, *, max_documents: int) -> list[dict]:
    """Add (or refresh) the sample library's manuals in a workspace."""
    registry = sample_models()
    records = []
    for doc in validate_documents(sample_documents()):
        _room(workspace, doc['id'], max_documents)
        started = perf_counter()
        record = sample_record(doc, registry)
        existing = workspace.record(record['id'])
        if existing and existing.get('sha256') == record['sha256'] and existing.get('embeddings') is not None:
            records.append(existing)
            continue
        vectors = embed(record, workspace, embedder)
        record['timings']['loadMs'] = _ms(started)
        workspace.save(record, vectors)
        records.append(record)
    return records


def sample_info(workspace: Workspace) -> dict:
    """The bundled sample library: what it holds and whether it is loaded."""
    try:
        documents = sample_documents()
    except FileNotFoundError:
        return {'available': False, 'loaded': False, 'documents': [], 'publisher': '', 'licence': '',
                'licenceUrl': '', 'queries': 0}
    publishers = list(dict.fromkeys(d['metadata'].get('publisher', '') for d in documents))
    licences = list(dict.fromkeys(d['metadata'].get('licence', '') for d in documents))
    return {
        'available': True,
        'loaded': all((r := workspace.record(d['id'])) is not None and r['format'] == 'sample' for d in documents),
        'documents': [{'id': d['id'], 'title': d['title'], 'units': len(d['sections'])} for d in documents],
        'publisher': ' and '.join(p for p in publishers if p),
        'licence': ', '.join(l for l in licences if l),
        'licenceUrl': documents[0]['metadata'].get('licenceUrl', '') if documents else '',
        'queries': len(sample_queries()),
    }
