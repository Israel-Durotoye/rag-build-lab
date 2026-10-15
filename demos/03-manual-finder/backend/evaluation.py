"""The labelled queries through every search mode, with actual results.

Each query (queries.json) names the model a support agent would have chosen
(none for the ambiguity cases), the passages that answer it, and whether the
right behaviour is to answer or to ask which model. For every mode a run
records the ranked passages, whether an expected passage is in the top k,
its rank, and how many top-k passages belong to another model (which the
filter should make zero). Ambiguity queries record whether Finder asked and
whether the right models were among the choices.

This is a small check over the sample library, not a benchmark: twelve
questions, one library, the settings of the run.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Callable

from rag_core.web.embeddings import Embedder
from rag_core.web.retrieval import MODES, retrieve

from . import cards, clarify
from .store import Workspace
from .turn import TIE_BREAK, read_codes
from .variants import applies

SCOPE = ('Twelve labelled questions over the sample library, run with the settings shown. A small check of '
         'retrieval and of when Finder asks, not a benchmark of answer quality.')


def run_query(workspace: Workspace, query: dict, *, modes: list[str], k: int, constant: int,
              embedder: Embedder | None) -> dict:
    library = workspace.library
    registry = library.registry()
    codes, searched, _, _ = read_codes(query['query'], workspace, registry)
    found = cards.entries(workspace) if codes else []
    decided = clarify.resolve(query['query'], query.get('model'), query.get('revision'), registry, library, searched,
                              with_code=cards.models_with_code(found, codes, registry))
    model, revision = decided['model'] or query.get('model'), decided['revision'] or query.get('revision')
    clarification = decided['clarification']
    if clarification is None and model and not revision:
        # The same check the answer pipeline makes before showing a card.
        for code in codes:
            hits = [e for e in cards.for_model(found, model) if e['code'] == code.code]
            clarification = clarify.code_revision_question(model, hits, registry, query['query'], code.display)
            if clarification:
                break
    row = {key: query.get(key) for key in ('id', 'query', 'kind', 'model', 'revision', 'expected', 'expectStatus')}
    row['forbidden'] = list(query.get('forbidden') or [])
    row.update(asked=clarification is not None, reason=(clarification or {}).get('reason'),
               candidates=[c['id'] for c in (clarification or {}).get('candidates', [])],
               matched=[c['id'] for c in (clarification or {}).get('candidates', []) if c.get('matched')],
               candidatesOk=None, modes={})
    allowed = library.allowed(model, revision) if model else None
    chunks = library.chunks()
    for mode in modes:
        trace = retrieve(library, searched, mode=mode, k=k, embedder=embedder, allowed=allowed, constant=constant,
                         tie_break=TIE_BREAK)
        ranked = trace['selected']
        if not row['asked'] and model and not revision:
            asked = clarify.revision_question(model, [(chunks[c]['revisions'].get(model), chunks[c]['text'])
                                                      for c in ranked if c in chunks], registry, query['query'])
            if asked:
                row.update(asked=True, reason='revision', candidates=[c['id'] for c in asked['candidates']],
                           matched=[c['id'] for c in asked['candidates'] if c['matched']])
        expected = set(query.get('expected') or [])
        rank = next((i for i, cid in enumerate(ranked, 1) if cid in expected), None)
        # Passages labelled by hand as a look-alike board's answer: an
        # independent check of the tags, unlike wrongModel, which uses them.
        lookalike = sum(1 for cid in ranked if cid in set(query.get('forbidden') or []))
        wrong = 0
        if model:
            wrong = sum(1 for cid in ranked if cid in chunks and not applies(
                {'models': chunks[cid]['models'], 'revisions': chunks[cid]['revisions']}, chunks[cid]['docModels'],
                model, revision))
        row['modes'][mode] = {'mode': mode, 'used': trace['mode'], 'ranked': ranked, 'hit': rank is not None,
                              'rank': rank, 'wrongModel': wrong, 'lookalike': lookalike}
    if query.get('expectStatus') == 'clarification':
        wanted = set(query.get('expectedCandidates') or [])
        # With no model chosen every model is offered; what counts is that the
        # right ones are marked as matching the question.
        pool = set(row['matched'] if row['reason'] == 'no_model' else row['candidates'])
        row['candidatesOk'] = row['asked'] and wanted <= pool
    row['lookup'] = None
    if model and not row['asked']:
        # The exact-code lookup is not a search mode: it reads the model's code
        # tables directly. Recorded separately so the modes are compared fairly.
        for code in cards.most_specific(codes, cards.entries(workspace)):
            found_card = cards.card(workspace, registry, code, model, revision)
            if found_card and found_card['kind'] == 'found':
                row['lookup'] = {'code': found_card['display'], 'chunkId': found_card['chunkId'],
                                 'hit': found_card['chunkId'] in set(query.get('expected') or [])}
                break
    return row


def run(workspace: Workspace, queries: list[dict], *, modes: list[str] | None, k: int, constant: int,
        embedder: Embedder | None, emit: Callable[[dict], None] = lambda event: None,
        cancelled: Callable[[], bool] = lambda: False) -> dict:
    modes = [m for m in (modes or list(MODES)) if m in MODES]
    rows = []
    for index, query in enumerate(queries):
        if cancelled():
            break
        emit({'type': 'progress', 'done': index, 'total': len(queries), 'query': query['query']})
        rows.append(run_query(workspace, query, modes=modes, k=k, constant=constant, embedder=embedder))
    emit({'type': 'progress', 'done': len(rows), 'total': len(queries)})
    answerable = [r for r in rows if r['expectStatus'] != 'clarification']
    asking = [r for r in rows if r['expectStatus'] == 'clarification']
    return {
        'id': secrets.token_hex(6),
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'k': k,
        'constant': constant,
        'embedder': getattr(embedder, 'name', None),
        'corpusVersion': workspace.library.index.version,
        'rows': rows,
        'totals': {mode: {'hits': sum(1 for r in answerable if r['modes'][mode]['hit']), 'of': len(answerable)}
                   for mode in modes},
        'lookup': {'hits': sum(1 for r in answerable if r['lookup'] and r['lookup']['hit']),
                   'of': sum(1 for r in answerable if r['lookup'])},
        'clarification': {'asked': sum(1 for r in asking if r['asked'] and r['candidatesOk']), 'of': len(asking)},
        # Look-alike passages labelled by hand that reached a top k, per mode.
        'lookalike': {'queries': sum(1 for r in rows if r['forbidden']),
                      'found': {mode: sum(r['modes'][mode]['lookalike'] for r in rows) for mode in modes}},
        'scope': SCOPE,
    }


def summary(run_record: dict) -> dict:
    return {key: run_record.get(key) for key in ('id', 'createdAt', 'k', 'constant', 'embedder', 'totals', 'lookup',
                                                 'clarification', 'lookalike')}
