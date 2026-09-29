"""Workspace-scoped storage on disk.

Each browser gets a random workspace ID (not authentication: it keeps one
visitor's notes out of another's searches). A workspace holds:

    index-section.sqlite     rag_core Index, one chunk per section
    index-fixed.sqlite       rag_core Index, fixed-length word windows (a last
                             window under a quarter of the size joins the one before)
    docs/<id>.json           document record: file facts and its sections
    docs/<id>.section.npy    one embedding row per section chunk
    docs/<id>.fixed.npy      one embedding row per fixed window
    chunking.json            the rules the fixed chunking was last built with
    settings.json            the student's settings
    practice/<id>.json       saved quizzes and flashcards

Both chunkings are kept side by side so the same question can be run against
each. Idle workspaces are deleted after ``ttl_days``.
"""
from __future__ import annotations

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

from rag_core.core import Chunk, Index, chunk_document

from .preferences import preferences

log = logging.getLogger('study_companion')
WORKSPACE_ID = re.compile(r'^[a-f0-9]{32}$')
DOCUMENT_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
PRACTICE_ID = re.compile(r'^[a-f0-9]{12}$')
CHUNKINGS = ('section', 'fixed')
MAX_PRACTICE_SETS = 30
# Raise when the way fixed windows are cut changes, so that workspaces built
# under the old rules are re-chunked the next time they are opened.
FIXED_RULES = 2


class WorkspaceError(ValueError):
    """A plain, user-facing workspace problem."""


def _write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def _stats(sizes: list[int]) -> dict:
    if not sizes:
        return {'count': 0, 'averageWords': 0, 'minWords': 0, 'maxWords': 0}
    return {'count': len(sizes), 'averageWords': round(sum(sizes) / len(sizes)), 'minWords': min(sizes),
            'maxWords': max(sizes)}


def source_document(record: dict) -> dict:
    """A record as the document rag_core indexes and expands from."""
    return {'id': record['id'], 'title': record['name'], 'version': record.get('version', '1'),
            'metadata': {'source': record['format']},
            'sections': [{'id': s['id'], 'title': s['title'], 'text': s['text'], 'location': s['location']}
                         for s in record['sections']]}


def min_tail(chunk_words: int) -> int:
    """A section's last fixed window joins the one before it when it holds
    fewer words than this, so no chunk is only a word or two long."""
    return chunk_words // 4


def chunk_record(record: dict, chunking: str, chunk_words: int) -> list[Chunk]:
    return chunk_document(source_document(record), chunking, chunk_words, min_tail(chunk_words))


def embedding_text(chunk: Chunk) -> str:
    return f'{chunk.title}\n{chunk.text}'


def summary(record: dict) -> dict:
    """Everything about a document except its text."""
    extraction = record['extraction']
    return {
        'id': record['id'], 'name': record['name'], 'format': record['format'], 'bytes': record['bytes'],
        'addedAt': record['addedAt'], 'pages': extraction['pageCount'], 'sections': len(record['sections']),
        'words': sum(s['words'] for s in record['sections']), 'characters': extraction['characters'],
        'ocrPages': extraction['ocrPages'], 'imageRegions': extraction['imageRegions'],
        'ocrFailed': extraction['ocrFailed'], 'truncated': record['truncated'],
        'embeddings': record['embeddings'] is not None, 'sample': record['format'] == 'sample',
        'overview': record.get('overview'),
    }


class ChunkView:
    """One chunking of the whole workspace: what ``rag_core.web.retrieval``
    searches (a keyword index, the chunks and their vectors)."""

    def __init__(self, workspace: 'Workspace', chunking: str):
        self.workspace = workspace
        self.chunking = chunking
        self.index = Index(workspace.dir / f'index-{chunking}.sqlite', stemming=True)
        self._chunks: dict[str, dict] | None = None
        self._vectors: tuple[list[str], np.ndarray] | None = None

    def invalidate(self) -> None:
        self._chunks = None
        self._vectors = None

    def reindex(self) -> None:
        workspace = self.workspace
        self.index.replace([source_document(r) for r in workspace._records.values()], self.chunking,
                           workspace.chunk_words, min_tail(workspace.chunk_words))
        self.invalidate()

    def chunks(self) -> dict[str, dict]:
        """Every chunk, keyed by its rag_core ID, with where it comes from."""
        workspace = self.workspace
        with workspace.lock:
            if self._chunks is None:
                found = {}
                for record in workspace._records.values():
                    sections = {s['id']: s for s in record['sections']}
                    pieces: dict[str, int] = {}
                    chunks = chunk_record(record, self.chunking, workspace.chunk_words)
                    for chunk in chunks:
                        pieces[chunk.metadata['section']] = pieces.get(chunk.metadata['section'], 0) + 1
                    for chunk in chunks:
                        section = sections[chunk.metadata['section']]
                        found[chunk.id] = {
                            'id': chunk.id, 'docId': record['id'], 'docName': record['name'],
                            'sectionId': section['id'], 'title': chunk.title, 'text': chunk.text,
                            'location': chunk.location, 'words': len(chunk.text.split()),
                            'piece': int(chunk.id.rsplit(':', 1)[1]) + 1, 'pieces': pieces[section['id']],
                            'sectionWords': section['words'], 'pages': section.get('pages'),
                            'ocr': section.get('ocr', False),
                        }
                self._chunks = found
            return self._chunks

    def vectors(self) -> tuple[list[str], np.ndarray] | None:
        """(chunk IDs, unit vectors) for every document that has embeddings."""
        workspace = self.workspace
        with workspace.lock:
            if self._vectors is None:
                ids, rows = [], []
                for record in workspace._records.values():
                    path = workspace.vector_path(record['id'], self.chunking)
                    if record['embeddings'] is None or not path.exists():
                        continue
                    matrix = np.load(path)
                    chunks = chunk_record(record, self.chunking, workspace.chunk_words)
                    if len(matrix) != len(chunks) or (rows and matrix.shape[1] != rows[0].shape[1]):
                        log.warning('Ignoring mismatched %s vectors for %s', self.chunking, record['id'])
                        continue
                    ids.extend(c.id for c in chunks)
                    rows.append(matrix)
                self._vectors = (ids, np.vstack(rows)) if rows else ([], np.zeros((0, 0), dtype=np.float32))
            ids, matrix = self._vectors
            return (ids, matrix) if ids else None


class Workspace:
    def __init__(self, root: Path, workspace_id: str):
        self.id = workspace_id
        self.dir = root / workspace_id
        (self.dir / 'docs').mkdir(parents=True, exist_ok=True)
        (self.dir / 'practice').mkdir(exist_ok=True)
        self.lock = RLock()
        self._records: dict[str, dict] = {}
        for path in sorted((self.dir / 'docs').glob('*.json')):
            try:
                record = json.loads(path.read_text())
                self._records[record['id']] = record
            except Exception:
                log.exception('Skipping unreadable document record %s', path.name)
        self.views = {chunking: ChunkView(self, chunking) for chunking in CHUNKINGS}
        self._last_touch = 0.0
        self.touch()

    def touch(self) -> None:
        now = time.time()
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
        """The student's stored settings (empty means defaults)."""
        return self._read_json(self.dir / 'settings.json') or {}

    def save_settings(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'settings.json', json.dumps(data, ensure_ascii=False).encode())

    @property
    def chunk_words(self) -> int:
        return preferences(self.settings())['chunkWords']

    # ------------------------------------------------------------ chunking

    def _rules(self) -> dict:
        """What the fixed chunking depends on."""
        return {'rules': FIXED_RULES, 'chunkWords': self.chunk_words, 'minTailWords': min_tail(self.chunk_words)}

    @property
    def needs_rechunk(self) -> bool:
        """True when the notes were chunked under other rules or another chunk
        size than the current ones (an upgrade, or a re-chunk that was cut short)."""
        with self.lock:
            return bool(self._records) and self._read_json(self.dir / 'chunking.json') != self._rules()

    def _mark_chunked(self) -> None:
        _write_atomic(self.dir / 'chunking.json', json.dumps(self._rules()).encode())

    # ----------------------------------------------------------- documents

    def records(self) -> list[dict]:
        with self.lock:
            return sorted(self._records.values(), key=lambda r: r['addedAt'])

    def record(self, doc_id: str) -> dict | None:
        with self.lock:
            return self._records.get(doc_id)

    def documents(self) -> list[dict]:
        """Every document in the shape rag_core expands parent sections from."""
        with self.lock:
            return [source_document(r) for r in self._records.values()]

    def vector_path(self, doc_id: str, chunking: str) -> Path:
        return self.dir / 'docs' / f'{doc_id}.{chunking}.npy'

    def _save_vectors(self, doc_id: str, chunking: str, vectors: np.ndarray | None) -> None:
        path = self.vector_path(doc_id, chunking)
        if vectors is None:
            path.unlink(missing_ok=True)
            return
        buffer = io.BytesIO()
        np.save(buffer, vectors.astype(np.float32))
        _write_atomic(path, buffer.getvalue())

    def _reindex(self) -> None:
        for view in self.views.values():
            view.reindex()

    def save(self, record: dict, vectors: dict[str, np.ndarray] | None = None, *,
             replace_vectors: bool = True) -> None:
        """Write a record. With replace_vectors (the default) its vector files
        are replaced by ``vectors`` (one matrix per chunking), or removed."""
        with self.lock:
            current = not self.needs_rechunk
            if replace_vectors:
                for chunking in CHUNKINGS:
                    self._save_vectors(record['id'], chunking, (vectors or {}).get(chunking))
            _write_atomic(self.dir / 'docs' / f"{record['id']}.json", json.dumps(record, ensure_ascii=False).encode())
            reindex = self._records.get(record['id'], {}).get('sections') != record['sections']
            self._records[record['id']] = record
            if reindex:
                self._reindex()
            elif replace_vectors:
                for view in self.views.values():
                    view.invalidate()
            if current:
                self._mark_chunked()

    def delete(self, doc_id: str) -> bool:
        with self.lock:
            if doc_id not in self._records:
                return False
            (self.dir / 'docs' / f'{doc_id}.json').unlink(missing_ok=True)
            for chunking in CHUNKINGS:
                self.vector_path(doc_id, chunking).unlink(missing_ok=True)
            del self._records[doc_id]
            self._reindex()
            return True

    def rechunk(self, embedder) -> int:
        """Rebuild the fixed-length chunking after the chunk size or the
        chunking rules changed. Returns how many fixed chunks there are now."""
        with self.lock:
            total = 0
            for record in self._records.values():
                chunks = chunk_record(record, 'fixed', self.chunk_words)
                total += len(chunks)
                vectors = None
                if embedder is not None and record['embeddings'] is not None:
                    vectors = embedder.embed_documents([embedding_text(c) for c in chunks])
                self._save_vectors(record['id'], 'fixed', vectors)
            self.views['fixed'].reindex()
            self._mark_chunked()
            return total

    def chunk_stats(self, record: dict) -> dict:
        """How this document is chunked in each mode, in words."""
        result = {}
        for chunking in CHUNKINGS:
            chunks = chunk_record(record, chunking, self.chunk_words)
            result[chunking] = _stats([len(c.text.split()) for c in chunks])
        result['fixed'].update(chunkWords=self.chunk_words, minTailWords=min_tail(self.chunk_words))
        return result

    # ------------------------------------------------------------ practice

    def practice_sets(self) -> list[dict]:
        """Saved sets, newest first."""
        with self.lock:
            sets = [s for s in (self._read_json(p) for p in (self.dir / 'practice').glob('*.json')) if s]
        return sorted(sets, key=lambda s: s['createdAt'], reverse=True)

    def practice_set(self, set_id: str) -> dict | None:
        return self._read_json(self.dir / 'practice' / f'{set_id}.json') if PRACTICE_ID.match(set_id) else None

    def save_practice(self, data: dict) -> None:
        with self.lock:
            _write_atomic(self.dir / 'practice' / f"{data['id']}.json", json.dumps(data, ensure_ascii=False).encode())
            for old in self.practice_sets()[MAX_PRACTICE_SETS:]:
                (self.dir / 'practice' / f"{old['id']}.json").unlink(missing_ok=True)

    def delete_practice(self, set_id: str) -> bool:
        if not PRACTICE_ID.match(set_id):
            return False
        path = self.dir / 'practice' / f'{set_id}.json'
        with self.lock:
            if not path.exists():
                return False
            path.unlink()
            return True

    def close(self) -> None:
        with self.lock:
            for view in self.views.values():
                view.index.close()


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
