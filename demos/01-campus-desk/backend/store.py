"""Workspace-scoped document storage on disk.

Each browser gets a random workspace ID (not authentication: it keeps one
visitor's documents out of another's searches). A workspace holds:

    index.sqlite       rag_core Index: chunk records + stemmed FTS5 (BM25)
    docs/<id>.json     document record: file facts, per-page stats, chunks
    docs/<id>.npy      one embedding row per chunk (when embeddings are on)

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
import time
from pathlib import Path
from threading import Lock, RLock

import numpy as np

from rag_core.core import Index

log = logging.getLogger('campus_guide')
WORKSPACE_ID = re.compile(r'^[a-f0-9]{32}$')
DOCUMENT_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')


class WorkspaceError(ValueError):
    """A plain, user-facing workspace problem."""


def chunk_id(doc_id: str, section_id: str) -> str:
    """The ID rag_core gives a chunk: document, section, piece."""
    return f'{doc_id}:{section_id}:0'


def _write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def summary(record: dict) -> dict:
    """Everything about a document except its chunk texts."""
    extraction = record['extraction']
    return {
        'id': record['id'], 'name': record['name'], 'format': record['format'], 'bytes': record['bytes'],
        'addedAt': record['addedAt'], 'pages': extraction['pageCount'], 'chunks': len(record['chunks']),
        'characters': extraction['characters'], 'ocrPages': extraction['ocrPages'],
        'imageRegions': extraction['imageRegions'], 'ocrFailed': extraction['ocrFailed'],
        'truncated': record['truncated'], 'embeddings': record['embeddings'] is not None,
        'overview': record.get('overview'),
    }


class Workspace:
    def __init__(self, root: Path, workspace_id: str):
        self.id = workspace_id
        self.dir = root / workspace_id
        (self.dir / 'docs').mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.index = Index(self.dir / 'index.sqlite', stemming=True)
        self._records: dict[str, dict] = {}
        for path in sorted((self.dir / 'docs').glob('*.json')):
            try:
                record = json.loads(path.read_text())
                self._records[record['id']] = record
            except Exception:
                log.exception('Skipping unreadable document record %s', path.name)
        self._vectors: tuple[list[str], np.ndarray] | None = None
        self._last_touch = 0.0
        self.touch()

    def touch(self) -> None:
        now = time.time()
        if now - self._last_touch > 60:
            (self.dir / '.last-used').write_text(str(int(now)))
            self._last_touch = now

    def records(self) -> list[dict]:
        with self.lock:
            return sorted(self._records.values(), key=lambda r: r['addedAt'])

    def record(self, doc_id: str) -> dict | None:
        with self.lock:
            return self._records.get(doc_id)

    def _reindex(self) -> None:
        self.index.replace([{
            'id': r['id'], 'title': r['name'], 'version': '1', 'metadata': {'source': 'upload'},
            'sections': [{'id': c['id'], 'title': c['title'], 'text': c['text'], 'location': c['location']}
                         for c in r['chunks']],
        } for r in self._records.values()])
        self._vectors = None

    def save(self, record: dict, vectors: np.ndarray | None = None, *, replace_vectors: bool = True) -> None:
        """Write a record. With replace_vectors (the default) its vector file
        is replaced by ``vectors``, or removed when there are none."""
        with self.lock:
            docs = self.dir / 'docs'
            if vectors is not None:
                buffer = io.BytesIO()
                np.save(buffer, vectors.astype(np.float32))
                _write_atomic(docs / f"{record['id']}.npy", buffer.getvalue())
                self._vectors = None
            elif replace_vectors:
                (docs / f"{record['id']}.npy").unlink(missing_ok=True)
                self._vectors = None
            _write_atomic(docs / f"{record['id']}.json", json.dumps(record, ensure_ascii=False).encode())
            reindex = self._records.get(record['id'], {}).get('chunks') != record['chunks']
            self._records[record['id']] = record
            if reindex:
                self._reindex()

    def delete(self, doc_id: str) -> bool:
        with self.lock:
            if doc_id not in self._records:
                return False
            for suffix in ('.json', '.npy'):
                (self.dir / 'docs' / f'{doc_id}{suffix}').unlink(missing_ok=True)
            del self._records[doc_id]
            self._reindex()
            return True

    def chunks(self) -> dict[str, dict]:
        """Every chunk, keyed by its rag_core ID, with its document's name."""
        with self.lock:
            return {chunk_id(r['id'], c['id']): {**c, 'id': chunk_id(r['id'], c['id']), 'docId': r['id'],
                                                 'docName': r['name']}
                    for r in self._records.values() for c in r['chunks']}

    def vectors(self) -> tuple[list[str], np.ndarray] | None:
        """(chunk IDs, unit vectors) for every document that has embeddings."""
        with self.lock:
            if self._vectors is None:
                ids, rows = [], []
                for r in self._records.values():
                    path = self.dir / 'docs' / f"{r['id']}.npy"
                    if r['embeddings'] is None or not path.exists():
                        continue
                    matrix = np.load(path)
                    if len(matrix) != len(r['chunks']) or (rows and matrix.shape[1] != rows[0].shape[1]):
                        log.warning('Ignoring mismatched vectors for %s', r['id'])
                        continue
                    ids.extend(chunk_id(r['id'], c['id']) for c in r['chunks'])
                    rows.append(matrix)
                self._vectors = (ids, np.vstack(rows)) if rows else ([], np.zeros((0, 0), dtype=np.float32))
            ids, matrix = self._vectors
            return (ids, matrix) if ids else None

    def signature(self) -> str:
        """Changes whenever the set of documents changes."""
        with self.lock:
            parts = sorted(f"{r['id']}:{r.get('sha256') or ''}" for r in self._records.values())
        return hashlib.sha256('|'.join(parts).encode()).hexdigest()[:16]

    def _read_json(self, name: str) -> dict | None:
        path = self.dir / name
        try:
            return json.loads(path.read_text()) if path.exists() else None
        except Exception:
            log.exception('Skipping unreadable %s', path)
            return None

    def settings(self) -> dict:
        """The guide owner's answer settings (empty means defaults)."""
        return self._read_json('settings.json') or {}

    def save_settings(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'settings.json', json.dumps(data, ensure_ascii=False).encode())

    def profile(self) -> dict | None:
        """The model-written welcome profile, if it matches the current documents."""
        data = self._read_json('profile.json')
        return data if data and data.get('signature') == self.signature() else None

    def save_profile(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'profile.json', json.dumps(data, ensure_ascii=False).encode())

    def close(self) -> None:
        with self.lock:
            self.index.close()


class DocumentStore:
    def __init__(self, root: Path, ttl_days: float = 7):
        self.root = root / 'workspaces'
        self.root.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_days * 86400
        self._open: dict[str, Workspace] = {}
        self._lock = Lock()

    def workspace(self, workspace_id: str | None) -> Workspace:
        if not workspace_id or not WORKSPACE_ID.match(workspace_id):
            raise WorkspaceError('Missing or invalid workspace ID.')
        with self._lock:
            workspace = self._open.get(workspace_id)
            if workspace is None:
                workspace = self._open[workspace_id] = Workspace(self.root, workspace_id)
        workspace.touch()
        return workspace

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
