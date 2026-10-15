"""Workspace-scoped storage on disk.

Each browser gets a random workspace ID (not authentication: it keeps one
visitor's manuals out of another's searches). A workspace holds:

    index.sqlite          rag_core Index over every unit of every manual
    docs/<id>.json        a manual: its source, models, sections, units, codes
    docs/<id>.npy         one embedding row per unit, in unit order
    settings.json         the workspace's settings
    runs/<id>.json        saved evaluation runs

Units are indexed one per rag_core "section", so a unit's chunk ID is
``<doc>:<unit>:0`` here, in the command-line demo and in queries.json alike.
Embeddings are cached by content under ``<data>/cache``, so the sample
library is embedded once per server, not once per visitor.
Idle workspaces are deleted after ``ttl_days``.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import shutil
import threading
import time
from collections import OrderedDict
from pathlib import Path
from threading import Lock, RLock

import numpy as np

from rag_core.core import Index

from .preferences import preferences
from .variants import Registry, applies

log = logging.getLogger('manual_finder')
WORKSPACE_ID = re.compile(r'^[a-f0-9]{32}\Z')
DOCUMENT_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}\Z')
RUN_ID = re.compile(r'^[a-f0-9]{12}\Z')
MAX_RUNS = 20
# Open workspaces (each holds a SQLite connection) beyond this many are
# closed once idle for a while; they open again from disk when next used.
MAX_OPEN = 64
IDLE_CLOSE_SECONDS = 600
# Expired workspaces are removed at startup and then about this often.
CLEANUP_EVERY_SECONDS = 3600


class WorkspaceError(ValueError):
    """A plain, user-facing workspace problem."""


def _write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def chunk_id(doc_id: str, unit_id: str) -> str:
    return f'{doc_id}:{unit_id}:0'


def source_document(record: dict) -> dict:
    """A manual as rag_core indexes it: one rag_core section per unit."""
    titles = {s['id']: s['title'] for s in record['sections']}
    return {'id': record['id'], 'title': record['name'], 'version': record.get('version', '1'),
            'metadata': {'source': record['format'], 'device': list(record['models'])},
            'sections': [{'id': u['id'], 'title': titles.get(u['sectionId'], record['name']), 'text': u['text'],
                          'location': u['location'],
                          'metadata': {'parent': u['sectionId'], 'kind': u['kind'],
                                       'device': list(u['models']) if u['models'] is not None
                                       else list(record['models'])}}
                         for u in record['units']]}


def embedding_text(record: dict, unit: dict, sections: dict[str, dict]) -> str:
    section = sections.get(unit['sectionId'])
    path = ' › '.join(section['path']) if section else record['name']
    return f'{path}\n{unit["text"]}'


def content_key(record: dict, model_name: str) -> str:
    """What a manual's embeddings depend on: the embedding model and the text
    of every unit with its place in the manual."""
    sections = {s['id']: s for s in record['sections']}
    texts = [embedding_text(record, u, sections) for u in record['units']]
    return hashlib.sha256(json.dumps([model_name, texts], ensure_ascii=False).encode()).hexdigest()


def registry_for(records: list[dict]) -> Registry:
    """Every model and family the manuals define (the first definition of an
    ID wins), plus the names of models outside the library."""
    models: dict[str, dict] = {}
    families: dict[str, dict] = {}
    outside: list[str] = []
    for record in records:
        for model in record.get('modelDefs', []):
            models.setdefault(model['id'], model)
        for family in record.get('families', []):
            if family['id'] in families:
                members = families[family['id']]['members']
                families[family['id']] = {**families[family['id']],
                                          'members': [*members, *(m for m in family['members'] if m not in members)]}
            else:
                families[family['id']] = family
        outside.extend(record.get('outside', []))
    return Registry(models, families, tuple(dict.fromkeys(outside)))


def summary(record: dict) -> dict:
    """Everything about a manual except its text."""
    extraction = record.get('extraction') or {}
    return {
        'id': record['id'], 'name': record['name'], 'format': record['format'], 'version': record.get('version', '1'),
        'addedAt': record['addedAt'], 'bytes': record.get('bytes', 0), 'pages': extraction.get('pageCount', 0),
        'sections': len(record['sections']), 'units': len(record['units']),
        'words': sum(len(u['text'].split()) for u in record['units']), 'codes': len(record.get('codes', [])),
        'models': list(record['models']), 'modelsConfirmed': record.get('modelsConfirmed', True),
        'source': record.get('source'), 'sample': record['format'] == 'sample',
        'ocrPages': extraction.get('ocrPages', 0), 'truncated': record.get('truncated', False),
        'embeddings': record.get('embeddings') is not None,
    }


class Library:
    """A workspace's manuals as retrieval sees them (rag_core.web.retrieval's
    ChunkSource): a keyword index, every unit keyed by chunk ID, and vectors."""

    def __init__(self, workspace: 'Workspace'):
        self.workspace = workspace
        self.index = Index(workspace.dir / 'index.sqlite', stemming=True)
        self._chunks: dict[str, dict] | None = None
        self._vectors: tuple[list[str], np.ndarray] | None = None
        self._registry: Registry | None = None

    def invalidate(self) -> None:
        self._chunks = None
        self._vectors = None
        self._registry = None

    def reindex(self) -> None:
        self.index.replace([source_document(r) for r in self.workspace._records.values()], 'section')
        self.invalidate()

    def chunks(self) -> dict[str, dict]:
        """Every unit, keyed by chunk ID, with where it comes from and which
        models it applies to."""
        workspace = self.workspace
        with workspace.lock:
            if self._chunks is None:
                found = {}
                for record in workspace._records.values():
                    sections = {s['id']: s for s in record['sections']}
                    for unit in record['units']:
                        section = sections.get(unit['sectionId'], {})
                        cid = chunk_id(record['id'], unit['id'])
                        found[cid] = {
                            'id': cid, 'docId': record['id'], 'docName': record['name'], 'unitId': unit['id'],
                            'sectionId': unit['sectionId'], 'title': section.get('title', record['name']),
                            'path': section.get('path', [record['name']]), 'text': unit['text'],
                            'location': unit['location'], 'kind': unit['kind'], 'models': unit['models'],
                            'revisions': unit.get('revisions', {}), 'header': unit.get('header'),
                            'docModels': list(record['models']), 'codes': unit.get('codes', []),
                        }
                self._chunks = found
            return self._chunks

    def vectors(self) -> tuple[list[str], np.ndarray] | None:
        """(chunk IDs, unit vectors) for every manual that has embeddings."""
        workspace = self.workspace
        with workspace.lock:
            if self._vectors is None:
                ids, rows = [], []
                for record in workspace._records.values():
                    path = workspace.vector_path(record['id'])
                    if record.get('embeddings') is None or not path.exists():
                        continue
                    matrix = np.load(path)
                    if len(matrix) != len(record['units']) or (rows and matrix.shape[1] != rows[0].shape[1]):
                        log.warning('Ignoring mismatched vectors for %s', record['id'])
                        continue
                    ids.extend(chunk_id(record['id'], u['id']) for u in record['units'])
                    rows.append(matrix)
                self._vectors = (ids, np.vstack(rows)) if rows else ([], np.zeros((0, 0), dtype=np.float32))
            ids, matrix = self._vectors
            return (ids, matrix) if ids else None

    def registry(self) -> Registry:
        with self.workspace.lock:
            if self._registry is None:
                self._registry = registry_for(list(self.workspace._records.values()))
            return self._registry

    def allowed(self, model: str | None, revision: str | None = None) -> set[str] | None:
        """Chunk IDs that apply to ``model`` (and ``revision``); None means no
        filter (no model chosen)."""
        if model is None:
            return None
        return {cid for cid, c in self.chunks().items()
                if applies({'models': c['models'], 'revisions': c['revisions']}, c['docModels'], model, revision)}


class Workspace:
    def __init__(self, root: Path, workspace_id: str, cache_dir: Path):
        self.id = workspace_id
        self.dir = root / workspace_id
        self.cache_dir = cache_dir
        (self.dir / 'docs').mkdir(parents=True, exist_ok=True)
        (self.dir / 'runs').mkdir(exist_ok=True)
        self.lock = RLock()
        self._records: dict[str, dict] = {}
        for path in sorted((self.dir / 'docs').glob('*.json')):
            try:
                record = json.loads(path.read_text())
                self._records[record['id']] = record
            except Exception:
                log.exception('Skipping unreadable manual record %s', path.name)
        self.library = Library(self)
        self._last_touch = 0.0
        self.touch()

    def touch(self) -> None:
        now = time.time()
        self.used_at = now
        if now - self._last_touch > 60:
            (self.dir / '.last-used').write_text(str(int(now)))
            self._last_touch = now

    # ------------------------------------------------------------ settings

    def _read_json(self, path: Path) -> dict | None:
        try:
            return json.loads(path.read_text()) if path.exists() else None
        except Exception:
            log.exception('Skipping unreadable %s', path)
            return None

    def settings(self) -> dict:
        """The stored settings (empty means defaults)."""
        return self._read_json(self.dir / 'settings.json') or {}

    def preferences(self) -> dict:
        return preferences(self.settings())

    def save_settings(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'settings.json', json.dumps(data, ensure_ascii=False).encode())

    # ----------------------------------------------------------- manuals

    def records(self) -> list[dict]:
        with self.lock:
            return sorted(self._records.values(), key=lambda r: (r['addedAt'], r['id']))

    def record(self, doc_id: str) -> dict | None:
        with self.lock:
            return self._records.get(doc_id)

    def vector_path(self, doc_id: str) -> Path:
        return self.dir / 'docs' / f'{doc_id}.npy'

    def cached_vectors(self, key: str) -> np.ndarray | None:
        path = self.cache_dir / f'{key}.npy'
        try:
            return np.load(path) if path.exists() else None
        except Exception:
            log.warning('Ignoring unreadable cached vectors %s', path.name)
            return None

    def cache_vectors(self, key: str, vectors: np.ndarray) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        buffer = io.BytesIO()
        np.save(buffer, vectors.astype(np.float32))
        _write_atomic(self.cache_dir / f'{key}.npy', buffer.getvalue())

    def save(self, record: dict, vectors: np.ndarray | None = None, *, replace_vectors: bool = True) -> None:
        """Write a manual. With replace_vectors (the default) its vector file
        is replaced by ``vectors``, or removed."""
        with self.lock:
            if replace_vectors:
                path = self.vector_path(record['id'])
                if vectors is None:
                    path.unlink(missing_ok=True)
                else:
                    buffer = io.BytesIO()
                    np.save(buffer, vectors.astype(np.float32))
                    _write_atomic(path, buffer.getvalue())
            _write_atomic(self.dir / 'docs' / f"{record['id']}.json",
                          json.dumps(record, ensure_ascii=False).encode())
            previous = self._records.get(record['id'])
            self._records[record['id']] = record
            if previous is None or source_document(previous) != source_document(record):
                self.library.reindex()
            else:
                self.library.invalidate()

    def delete(self, doc_id: str) -> bool:
        with self.lock:
            if doc_id not in self._records:
                return False
            (self.dir / 'docs' / f'{doc_id}.json').unlink(missing_ok=True)
            self.vector_path(doc_id).unlink(missing_ok=True)
            del self._records[doc_id]
            self.library.reindex()
            return True

    # ---------------------------------------------------------- evaluation

    def runs(self) -> list[dict]:
        """Saved evaluation runs, newest first."""
        with self.lock:
            runs = [r for r in (self._read_json(p) for p in (self.dir / 'runs').glob('*.json')) if r]
        return sorted(runs, key=lambda r: r['createdAt'], reverse=True)

    def run(self, run_id: str) -> dict | None:
        return self._read_json(self.dir / 'runs' / f'{run_id}.json') if RUN_ID.match(run_id) else None

    def save_run(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'runs' / f"{data['id']}.json", json.dumps(data, ensure_ascii=False).encode())
            for old in self.runs()[MAX_RUNS:]:
                (self.dir / 'runs' / f"{old['id']}.json").unlink(missing_ok=True)

    def delete_run(self, run_id: str) -> bool:
        if not RUN_ID.match(run_id):
            return False
        path = self.dir / 'runs' / f'{run_id}.json'
        with self.lock:
            if not path.exists():
                return False
            path.unlink()
            return True

    def close(self) -> None:
        with self.lock:
            self.library.index.close()


class DocumentStore:
    def __init__(self, root: Path, ttl_days: float = 7):
        self.root = root / 'workspaces'
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache_dir = root / 'cache'
        self.blank_root = root / 'blank'
        self.ttl_seconds = ttl_days * 86400
        self._open: OrderedDict[str, Workspace] = OrderedDict()
        self._blank: Workspace | None = None
        self._cleaned = time.time()
        self._lock = Lock()

    def workspace(self, workspace_id: str | None, create: bool = True) -> Workspace:
        """The workspace with this ID. With ``create`` False, one that doesn't
        exist yet is not created: a shared empty workspace stands in, which
        the routes that use it never write to."""
        if not workspace_id or not WORKSPACE_ID.match(workspace_id):
            raise WorkspaceError('Missing or invalid workspace ID.')
        with self._lock:
            workspace = self._open.get(workspace_id)
            if workspace is not None:
                self._open.move_to_end(workspace_id)
            elif not create and not (self.root / workspace_id).is_dir():
                if self._blank is None:
                    self._blank = Workspace(self.blank_root, 'empty', self.cache_dir)
                return self._blank
            else:
                workspace = self._open[workspace_id] = Workspace(self.root, workspace_id, self.cache_dir)
                self._close_idle()
        workspace.touch()
        self._clean_now_and_then()
        return workspace

    def _close_idle(self) -> None:
        """Beyond MAX_OPEN, close the least recently used workspaces that have
        been idle a while (one in use is never closed). Holds self._lock."""
        cutoff = time.time() - IDLE_CLOSE_SECONDS
        for key in list(self._open):
            if len(self._open) <= MAX_OPEN:
                return
            if self._open[key].used_at < cutoff:
                self._open.pop(key).close()

    def _clean_now_and_then(self) -> None:
        with self._lock:
            if time.time() - self._cleaned < CLEANUP_EVERY_SECONDS:
                return
            self._cleaned = time.time()
        threading.Thread(target=self.cleanup, daemon=True).start()

    def cleanup(self) -> int:
        """Delete workspaces idle for longer than the TTL. Returns how many."""
        removed, cutoff = 0, time.time() - self.ttl_seconds
        for path in self.root.iterdir():
            if not path.is_dir() or not WORKSPACE_ID.match(path.name):
                continue
            marker = path / '.last-used'
            last = marker.stat().st_mtime if marker.exists() else path.stat().st_mtime
            if last >= cutoff:
                continue
            with self._lock:
                workspace = self._open.pop(path.name, None)
            if workspace:
                workspace.close()
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
        return removed

    def close(self) -> None:
        with self._lock:
            for workspace in self._open.values():
                workspace.close()
            self._open.clear()
            if self._blank is not None:
                self._blank.close()
                self._blank = None
