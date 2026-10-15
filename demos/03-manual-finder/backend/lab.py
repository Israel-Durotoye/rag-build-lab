"""The search-mode lab: one query through keyword, semantic and hybrid
search, side by side, with the same model filter.

No model writes anything here. The reply carries every candidate list, so
the page can draw the lines between the columns, write out each hybrid score
and re-fuse the lists for any RRF constant without asking the server again.
"""
from __future__ import annotations

from time import perf_counter

from rag_core.web.embeddings import Embedder
from rag_core.web.retrieval import fuse, retrieve

from .store import Workspace
from .turn import TIE_BREAK, read_codes


def run(workspace: Workspace, query: str, *, model: str | None, revision: str | None, k: int, constant: int,
        embedder: Embedder | None, labelled: list[dict] = ()) -> dict:
    started = perf_counter()
    library = workspace.library
    registry = library.registry()
    _, searched, read_as, _ = read_codes(query, workspace, registry)
    allowed = library.allowed(model, revision)
    keyword = retrieve(library, searched, mode='keyword', k=k, allowed=allowed, constant=constant, tie_break=TIE_BREAK)
    semantic = retrieve(library, searched, mode='semantic', k=k, embedder=embedder, allowed=allowed,
                        constant=constant, tie_break=TIE_BREAK)
    keyword_ids = [r['id'] for r in keyword['keyword']['results']]
    semantic_ids = [r['id'] for r in semantic['semantic']['results']]
    fused = fuse([keyword_ids, semantic_ids], constant, TIE_BREAK)
    shown = set(keyword_ids) | set(semantic_ids)
    chunks = library.chunks()
    every = set(chunks)
    match = next((q for q in labelled if q['query'].strip().lower() == query.strip().lower()), None)
    return {
        'query': query,
        'readAs': read_as,
        'filter': {'model': model, 'revision': revision,
                   'allowed': len(allowed) if allowed is not None else len(every),
                   'excluded': len(every - allowed) if allowed is not None else 0},
        'k': k,
        'constant': constant,
        'tieBreak': TIE_BREAK,
        'keyword': {'terms': keyword['keyword']['terms'], 'results': keyword['keyword']['results']},
        'semantic': {'available': semantic['semantic']['available'], 'reason': semantic['semantic'].get('reason'),
                     'model': semantic['semantic'].get('model'), 'results': semantic['semantic']['results']},
        'fused': [{'id': f['id'], 'rank': rank, 'score': f['score'], 'ranks': f['ranks'], 'bestRank': f['bestRank'],
                   'tied': f['tied']} for rank, f in enumerate(fused, 1)],
        'chunks': {cid: {key: chunks[cid][key] for key in ('id', 'docId', 'docName', 'unitId', 'sectionId', 'title',
                                                           'path', 'text', 'location', 'kind', 'models', 'revisions',
                                                           'header')}
                   for cid in shown if cid in chunks},
        'expected': list(match['expected']) if match else [],
        'queryId': match['id'] if match else None,
        'ms': round((perf_counter() - started) * 1000, 1),
    }
