"""The retrieval layer: find the chunks most likely to answer a query.

Two retrievers run side by side and their rankings are fused:

* keyword — SQLite FTS5 with the Porter stemmer, ranked by BM25 (rag_core);
* semantic — cosine similarity between the query's embedding and every
  chunk's embedding;
* hybrid — reciprocal rank fusion (RRF): each chunk scores
  sum(1 / (60 + rank)) over the rankings it appears in. Only ranks are
  combined: a BM25 score and a cosine similarity are on different scales,
  so adding them would mean nothing.

Everything is returned as a trace so the interface can show why each
passage was chosen.
"""
from __future__ import annotations

from fractions import Fraction
from time import perf_counter
from typing import Protocol

import numpy as np

from ..core import Index, rrf, tokens
from .embeddings import Embedder

CANDIDATES = 20
RRF_CONSTANT = 60
MAX_RRF_CONSTANT = 1000
MODES = ('hybrid', 'keyword', 'semantic')
# How passages with equal fused scores are ordered. "id": by passage ID (what
# rag_core.core.rrf does). "best-rank": first the passage that some retriever
# ranked higher (its best single rank), then by passage ID.
TIE_BREAKS = ('id', 'best-rank')


def fuse(rankings: list[list[str]], constant: int = RRF_CONSTANT, tie_break: str = 'best-rank') -> list[dict]:
    """Reciprocal rank fusion with exact arithmetic.

    Each item scores sum(1 / (constant + rank)) over the rankings it appears
    in. Scores are compared as fractions, so two items tie only when their
    sums are truly equal (1/61 + 1/63 and 1/63 + 1/61, or 2/122 and 1/61),
    never because of floating-point rounding. Ties are ordered by
    ``tie_break``; either way the result never depends on input order.

    Returns, in fused order: {'id', 'score' (float, for display), 'ranks'
    (one rank or None per ranking), 'bestRank', 'tied' (shares its score with
    another item)}."""
    if type(constant) is not int or not 1 <= constant <= MAX_RRF_CONSTANT:
        raise ValueError(f'The RRF constant must be a whole number from 1 to {MAX_RRF_CONSTANT}.')
    if tie_break not in TIE_BREAKS:
        raise ValueError(f'Tie break must be one of {", ".join(TIE_BREAKS)}')
    ranks: dict[str, list[int | None]] = {}
    for position, ranking in enumerate(rankings):
        for rank, item in enumerate(dict.fromkeys(ranking), 1):
            ranks.setdefault(item, [None] * len(rankings))[position] = rank
    scores = {item: sum((Fraction(1, constant + r) for r in found if r is not None), Fraction(0))
              for item, found in ranks.items()}
    best = {item: min(r for r in found if r is not None) for item, found in ranks.items()}
    if tie_break == 'best-rank':
        order = sorted(ranks, key=lambda i: (-scores[i], best[i], i))
    else:
        order = sorted(ranks, key=lambda i: (-scores[i], i))
    counts: dict[Fraction, int] = {}
    for score in scores.values():
        counts[score] = counts.get(score, 0) + 1
    return [{'id': item, 'score': round(float(scores[item]), 6), 'ranks': ranks[item], 'bestRank': best[item],
             'tied': counts[scores[item]] > 1} for item in order]


class ChunkSource(Protocol):
    """What retrieval needs from a store: a keyword index, every chunk keyed by
    its index ID (each with at least ``docId``), and the chunks' unit vectors."""
    index: Index

    def chunks(self) -> dict[str, dict]: ...

    def vectors(self) -> tuple[list[str], np.ndarray] | None: ...


def _ms(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def retrieve(workspace: ChunkSource, query: str, *, mode: str = 'hybrid', k: int = 6,
             embedder: Embedder | None = None, document_ids: list[str] | None = None,
             allowed: set[str] | None = None, constant: int = RRF_CONSTANT, tie_break: str = 'id') -> dict:
    """``allowed``, when given, is the set of chunk IDs that may be returned
    at all: a filter applied before ranking, so excluded chunks never take a
    rank (Manual Finder passes the passages that apply to the chosen model).
    ``constant`` and ``tie_break`` shape the hybrid fusion (see ``fuse``)."""
    if mode not in MODES:
        raise ValueError(f'Retrieval mode must be one of {", ".join(MODES)}')
    if tie_break not in TIE_BREAKS:
        raise ValueError(f'Tie break must be one of {", ".join(TIE_BREAKS)}')
    started = perf_counter()
    chunks = workspace.chunks()
    permitted = allowed
    allowed = {cid for cid, c in chunks.items()
               if (not document_ids or c['docId'] in document_ids) and (permitted is None or cid in permitted)}

    keyword_started = perf_counter()
    # The filter is applied before the candidate cut, so passages that may not
    # be returned never take the places of ones that may.
    keyword = workspace.index.keyword_matches(query, limit=CANDIDATES, ids=allowed)
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
    tied: set[str] = set()
    if used == 'hybrid' and tie_break == 'id' and constant == RRF_CONSTANT:
        # The original behaviour, unchanged for the sites that rely on it.
        ranking = rrf([keyword_ids, semantic_ids], RRF_CONSTANT)
    elif used == 'hybrid':
        fusion = fuse([keyword_ids, semantic_ids], constant, tie_break)
        ranking = [item['id'] for item in fusion]
        tied = {item['id'] for item in fusion if item['tied']}
    elif used == 'semantic':
        ranking = semantic_ids
    else:
        ranking = keyword_ids
    fused = []
    for rank, cid in enumerate(ranking, 1):
        score = sum(1 / (constant + ranks[cid]) for ranks in (keyword_rank, semantic_rank) if cid in ranks)
        entry = {'id': cid, 'rank': rank, 'score': round(score, 5),
                 'keywordRank': keyword_rank.get(cid), 'semanticRank': semantic_rank.get(cid)}
        if tie_break != 'id':
            entry['tied'] = cid in tied
        fused.append(entry)
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
        'fused': {'constant': constant, 'tieBreak': tie_break, 'results': fused[:CANDIDATES]},
        'selected': selected,
        'chunks': {cid: chunks[cid] for cid in shown},
        'ms': _ms(started),
    }
