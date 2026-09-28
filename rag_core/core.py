from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone, date
from hashlib import sha256
from functools import wraps
from pathlib import Path
from threading import RLock
import json
import math
import re
import sqlite3
from typing import Protocol

STOP = set('a an the is are was were what how when where who why of to in on at for and or it its this that does do can i my me with about'.split())


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r'[\w]+', text.lower()) if t not in STOP]


@dataclass(frozen=True)
class Chunk:
    id: str
    doc_id: str
    title: str
    text: str
    location: str
    metadata: dict


class Embedder(Protocol):
    def documents(self, texts: list[str]) -> list[list[float]]: ...
    def query(self, text: str) -> list[float]: ...


def chunk_document(doc: dict, mode: str = 'section', size: int = 120) -> list[Chunk]:
    if mode not in {'section', 'fixed'} or size < 1:
        raise ValueError('Invalid chunk mode or size')
    result = []
    for section in doc['sections']:
        words = section['text'].split()
        pieces = [section['text']] if mode == 'section' else [' '.join(words[i:i+size]) for i in range(0, len(words), size)]
        for i, text in enumerate(pieces):
            result.append(Chunk(f"{doc['id']}:{section['id']}:{i}", doc['id'], section['title'], text,
                                section.get('location', section['id']),
                                {**doc.get('metadata', {}), 'section': section['id'], 'version': doc.get('version', '1'),
                                 'content_hash': sha256(text.encode()).hexdigest()}))
    return result


def synchronized(method):
    """Serialize whole index operations, including nested reads during a write."""
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return wrapped


class Index:
    """One collection per SQLite database; replace is atomic and removes old chunks.

    With ``stemming=True`` the full-text index uses FTS5's Porter stemmer, so
    "fail" also matches "failed" and "exam" matches "exams"."""
    def __init__(self, path: str | Path = ':memory:', stemming: bool = False):
        if str(path) != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # Streamlit reruns a session on new script threads. Keep its connection
        # reusable while serializing operations (not just individual SQL calls).
        self._lock = RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        tokenizer = ", tokenize='porter unicode61'" if stemming else ''
        self.db.executescript(f'''
          CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, doc_id TEXT, title TEXT, text TEXT, location TEXT, metadata TEXT);
          CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, title, text{tokenizer});
          CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
        ''')

    @synchronized
    def close(self):
        self.db.close()

    @synchronized
    def replace(self, documents: list[dict], mode='section', size=120):
        chunks = [c for d in documents for c in chunk_document(d, mode, size)]
        if len({c.id for c in chunks}) != len(chunks):
            raise ValueError('Duplicate document/section identifiers')
        fingerprint = sha256(json.dumps([asdict(c) for c in chunks], sort_keys=True).encode()).hexdigest()
        with self.db:
            self.db.execute('DELETE FROM chunks')
            self.db.execute('DELETE FROM search')
            for c in chunks:
                self.db.execute('INSERT INTO chunks VALUES(?,?,?,?,?,?)', (c.id,c.doc_id,c.title,c.text,c.location,json.dumps(c.metadata)))
                self.db.execute('INSERT INTO search VALUES(?,?,?)', (c.id,c.title,c.text))
            self.db.execute('INSERT OR REPLACE INTO state VALUES(?,?)', ('version', fingerprint))
            self.db.execute('INSERT OR REPLACE INTO state VALUES(?,?)', ('refreshed', datetime.now(timezone.utc).isoformat()))

    @property
    @synchronized
    def version(self):
        r = self.db.execute("SELECT value FROM state WHERE key='version'").fetchone()
        return r[0] if r else ''

    @synchronized
    def delete(self, doc_id: str):
        with self.db:
            self.db.execute('DELETE FROM search WHERE id IN (SELECT id FROM chunks WHERE doc_id=?)', (doc_id,))
            self.db.execute('DELETE FROM chunks WHERE doc_id=?', (doc_id,))
            # Revision changes even when a removed source had the same text.
            self.db.execute('INSERT OR REPLACE INTO state VALUES(?,?)', ('version', sha256((self.version+'delete:'+doc_id).encode()).hexdigest()))

    def allowed(self, c: Chunk, filters: dict, tenants: set[str] | None):
        # Tenant-tagged documents are denied by default, including direct previews.
        tenant = c.metadata.get('tenant')
        if tenant is not None and (tenants is None or tenant not in tenants):
            return False
        for key, value in filters.items():
            if key == 'doc_id':
                if c.doc_id != value: return False
            elif key == 'as_of':
                day = date.fromisoformat(value)
                start = date.fromisoformat(c.metadata['effective_from'])
                end = date.fromisoformat(c.metadata['effective_to'])
                if not start <= day < end: return False
            elif c.metadata.get(key) != value:
                return False
        return True

    @staticmethod
    def unpack(r):
        return Chunk(r['id'],r['doc_id'],r['title'],r['text'],r['location'],json.loads(r['metadata']))

    @synchronized
    def chunks(self, filters=None, tenants=None):
        return [c for r in self.db.execute('SELECT * FROM chunks ORDER BY id')
                if self.allowed(c := self.unpack(r), filters or {}, tenants)]

    @synchronized
    def source(self, source_id, filters=None, tenants=None):
        r = self.db.execute('SELECT * FROM chunks WHERE id=?', (source_id,)).fetchone()
        if r and self.allowed(c := self.unpack(r), filters or {}, tenants): return c
        return None

    @synchronized
    def keyword_matches(self, question, limit=20, filters=None, tenants=None):
        """BM25-ranked keyword matches with their scores (higher is better) and
        the query terms each chunk matched, for explaining retrieval."""
        allowed = {c.id: c for c in self.chunks(filters, tenants)}
        terms = list(dict.fromkeys(tokens(question)))[:64]
        if not terms or not allowed:
            return []
        quoted = ['"'+t.replace('"','""')+'"' for t in terms]
        rows = self.db.execute('SELECT id, bm25(search) FROM search WHERE search MATCH ? ORDER BY bm25(search), id',
                               (' OR '.join(quoted),)).fetchall()
        hits = [(r[0], -r[1]) for r in rows if r[0] in allowed][:limit]
        if not hits:
            return []
        ids = [i for i, _ in hits]
        matched = {i: [] for i in ids}
        marks = ','.join('?' * len(ids))
        for term, q in zip(terms, quoted):
            for (i,) in self.db.execute(f'SELECT id FROM search WHERE search MATCH ? AND id IN ({marks})', (q, *ids)):
                matched[i].append(term)
        return [{'chunk': allowed[i], 'score': score, 'terms': matched[i]} for i, score in hits]

    @synchronized
    def search(self, question, k=4, mode='keyword', embedder=None, filters=None, tenants=None, reranker=None):
        if mode not in {'keyword','dense','hybrid'} or not 1 <= k <= 50:
            raise ValueError('Invalid retrieval mode or k')
        candidates = self.chunks(filters, tenants)
        allowed = {c.id: c for c in candidates}
        terms = list(dict.fromkeys(tokens(question)))[:64]
        keyword = []
        if terms:
            query = ' OR '.join('"'+t.replace('"','""')+'"' for t in terms)
            keyword = [r[0] for r in self.db.execute('SELECT id FROM search WHERE search MATCH ? ORDER BY bm25(search), id', (query,)) if r[0] in allowed]
        dense = []
        if mode in {'dense','hybrid'}:
            if embedder is None: raise ValueError('Dense/hybrid search requires an embedding model')
            if candidates:
                q = embedder.query(question)
                vectors = embedder.documents([c.text for c in candidates])
                if len(vectors) != len(candidates): raise ValueError('Embedding count mismatch')
                dense = [c.id for score,c in sorted(((cosine(q,v),c) for c,v in zip(candidates,vectors)),key=lambda p:(-p[0],p[1].id)) if score > 0]
        ranked = keyword if mode=='keyword' else dense if mode=='dense' else rrf([keyword,dense])
        found = [allowed[i] for i in ranked[:max(k,12)]]
        if reranker and found: found = reranker.rank(question, found)
        return found[:k]


def cosine(a, b):
    if not a or len(a) != len(b): raise ValueError('Embedding dimensions differ')
    if not all(math.isfinite(x) for x in [*a,*b]): raise ValueError('Non-finite embedding')
    denom = math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))
    return sum(x*y for x,y in zip(a,b))/denom if denom else 0.0


def rrf(rankings: list[list[str]], constant=60):
    if constant <= 0: raise ValueError('RRF constant must be positive')
    scores = {}
    for ranking in rankings:
        for rank, item in enumerate(dict.fromkeys(ranking), 1):
            scores[item] = scores.get(item,0) + 1/(constant+rank)
    return sorted(scores, key=lambda i:(-scores[i],i))
