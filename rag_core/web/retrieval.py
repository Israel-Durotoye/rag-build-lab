"""The retrieval layer: find the chunks most likely to answer a query.

Two retrievers run side by side and their rankings are fused:

* keyword — SQLite FTS5 with the Porter stemmer, ranked by BM25 (rag_core);
* semantic — cosine similarity between the query's embedding and every
  chunk's embedding;
* hybrid — reciprocal rank fusion (RRF): each chunk scores
  sum(1 / (60 + rank)) over the rankings it appears in.

Everything is returned as a trace so the interface can show why each
passage was chosen.
"""
from __future__ import annotations

from time import perf_counter
from typing import Protocol

import numpy as np

from ..core import Index, rrf, tokens
from .embeddings import Embedder

CANDIDATES = 20
RRF_CONSTANT = 60
MODES = ('hybrid', 'keyword', 'semantic')


class ChunkSource(Protocol):
    """What retrieval needs from a store: a keyword index, every chunk keyed by
    its index ID (each with at least ``docId``), and the chunks' unit vectors."""
    index: Index

    def chunks(self) -> dict[str, dict]: ...

    def vectors(self) -> tuple[list[str], np.ndarray] | None: ...


def _ms(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def retrieve(workspace: ChunkSource, query: str, *, mode: str = 'hybrid', k: int = 6,
             embedder: Embedder | None = None, document_ids: list[str] | None = None) -> dict:
    if mode not in MODES:
        raise ValueError(f'Retrieval mode must be one of {", ".join(MODES)}')
    started = perf_counter()
    chunks = workspace.chunks()
    allowed = {cid for cid, c in chunks.items() if not document_ids or c['docId'] in document_ids}

    keyword_started = perf_counter()
    keyword = [hit for hit in workspace.index.keyword_matches(query, limit=CANDIDATES * 3)
               if hit['chunk'].id in allowed][:CANDIDATES]
    keyword_trace = {
        'terms': list(dict.fromkeys(tokens(query)))[:64],
        'results': [{'id': hit['chunk'].id, 'rank': rank, 'score': round(hit['score'], 4), 'terms': hit['terms']}
                    for rank, hit in enumerate(keyword, 1)],
        'ms': _ms(keyword_started),
    }

    used = mode
    semantic_trace = {'available': False, 'model': getattr(embedder, 'name', None), 'results': [], 'ms': 0.0}
    vectors = workspace.vectors() if mode != 'keyword' else None
    if mode != 'keyword':
        if embedder is None or vectors is None:
            used = 'keyword'
            semantic_trace['reason'] = ('Semantic search is off on this server.' if embedder is None
                                        else 'This document has no embeddings.')
        else:
            semantic_started = perf_counter()
            ids, matrix = vectors
            query_vector = embedder.embed_query(query)
            similarity = matrix @ query_vector
            order = [i for i in np.argsort(-similarity) if ids[i] in allowed][:CANDIDATES]
            semantic_trace.update(available=True, dimensions=int(matrix.shape[1]), ms=_ms(semantic_started),
                                  results=[{'id': ids[i], 'rank': rank, 'similarity': round(float(similarity[i]), 4)}
                                           for rank, i in enumerate(order, 1)])

    keyword_ids = [r['id'] for r in keyword_trace['results']]
    semantic_ids = [r['id'] for r in semantic_trace['results']]
    keyword_rank = {cid: r for r, cid in enumerate(keyword_ids, 1)}
    semantic_rank = {cid: r for r, cid in enumerate(semantic_ids, 1)}
    if used == 'hybrid':
        ranking = rrf([keyword_ids, semantic_ids], RRF_CONSTANT)
    elif used == 'semantic':
        ranking = semantic_ids
    else:
        ranking = keyword_ids
    fused = []
    for rank, cid in enumerate(ranking, 1):
        score = sum(1 / (RRF_CONSTANT + ranks[cid]) for ranks in (keyword_rank, semantic_rank) if cid in ranks)
        fused.append({'id': cid, 'rank': rank, 'score': round(score, 5),
                      'keywordRank': keyword_rank.get(cid), 'semanticRank': semantic_rank.get(cid)})
    selected = ranking[:k]

    shown = set(keyword_ids) | set(semantic_ids) | set(selected)
    return {
        'query': query,
        'mode': used,
        'requestedMode': mode,
        'k': k,
        'candidates': CANDIDATES,
        'totalChunks': len(allowed),
        'keyword': keyword_trace,
        'semantic': semantic_trace,
        'fused': {'constant': RRF_CONSTANT, 'results': fused[:CANDIDATES]},
        'selected': selected,
        'chunks': {cid: chunks[cid] for cid in shown},
        'ms': _ms(started),
    }
