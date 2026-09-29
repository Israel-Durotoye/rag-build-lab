"""The chunking lab: one question, both chunkings, side by side.

No model is involved. Each run records what was retrieved, what reached the
context and what the word budget left out. It reports differences; it does
not pick a winner.
"""
from __future__ import annotations

from rag_core.web.embeddings import Embedder
from rag_core.web.retrieval import retrieve

from . import context as context_layer
from .store import CHUNKINGS, Workspace

SCOPE = ('What each chunking retrieved for this one question. A difference here is an observation, '
         'not a verdict: neither chunking is declared better.')


def _run(workspace: Workspace, chunking: str, query: str, *, mode: str, expand: bool, options: dict,
         embedder: Embedder | None, document_ids: list[str] | None) -> dict:
    view = workspace.views[chunking]
    trace = retrieve(view, query, mode=mode, k=options['k'], embedder=embedder, document_ids=document_ids)
    ranks = {r['id']: r for r in trace['fused']['results']}
    context = context_layer.build(view, workspace, trace['selected'], budget=options['budgetWords'],
                                  expand_below=options['expandBelowWords'], expand=expand)
    items = context['items']
    return {
        'chunking': chunking,
        'chunkWords': options['chunkWords'] if chunking == 'fixed' else None,
        'mode': trace['mode'],
        'totalChunks': trace['totalChunks'],
        'retrieved': [{**trace['chunks'][cid], 'rank': rank, 'keywordRank': ranks[cid]['keywordRank'],
                       'semanticRank': ranks[cid]['semanticRank']}
                      for rank, cid in enumerate(trace['selected'], 1)],
        'weak': bool(trace['selected']) and not trace['keyword']['results'],
        'context': items,
        'budget': context['budget'],
        'caveats': context_layer.caveats(query, items),
        'sections': list(dict.fromkeys(f"{i['docId']}:{i['sectionId']}" for i in items)),
        'expanded': sum(1 for i in items if i['expanded']),
        'ms': round(trace['ms'] + context['ms'], 1),
    }


def compare(workspace: Workspace, query: str, *, mode: str, expand: bool, options: dict,
            embedder: Embedder | None, document_ids: list[str] | None) -> dict:
    runs = {chunking: _run(workspace, chunking, query, mode=mode, expand=expand, options=options,
                           embedder=embedder, document_ids=document_ids) for chunking in CHUNKINGS}
    section, fixed = runs['section']['sections'], runs['fixed']['sections']
    titles = {f"{i['docId']}:{i['sectionId']}": {'title': i['title'], 'docName': i['docName'], 'location': i['location']}
              for run in runs.values() for i in run['context']}
    return {
        'query': query,
        'requestedMode': mode,
        'expand': expand,
        'options': options,
        'runs': runs,
        'agreement': {'both': [s for s in section if s in fixed],
                      'sectionOnly': [s for s in section if s not in fixed],
                      'fixedOnly': [s for s in fixed if s not in section]},
        'titles': titles,
        'scope': SCOPE,
    }
