"""One question through the whole pipeline, as a stream of events:

    identify → (clarification) → card → retrieval → excluded → context →
    generation (reasoning, tokens) → done

1. Identify: read codes ("e-17" → E17) and model names in the question, and
   decide the model (clarify.py). With no model, Finder asks and stops.
2. Card: an exact code is looked up in the model's code tables.
3. Retrieval: keyword, semantic or hybrid search over the passages that apply
   to the model, the filter applied before ranking. What other models'
   passages would have matched is found separately, for the greyed panel.
4. Context: each passage grows to its section as the model sees it.
5. Generation: the model writes from the numbered passages; citations are
   checked. Without a model, the manual's own sentences are returned.

Every layer's trace goes to the client, which shows it on the Inspect page.
"""
from __future__ import annotations

from time import perf_counter
from typing import Callable, Iterator

from rag_core.providers import ProviderError
from rag_core.study import is_followup
from rag_core.web.answers import needs_rewrite, parse_citations, rewrite_query
from rag_core.web.embeddings import Embedder
from rag_core.web.retrieval import retrieve

from . import cards, clarify, identifiers
from . import context as context_layer
from .prompting import MAX_EARLIER, build_prompt
from .store import Workspace

ANSWER_TOKENS = 3000
TEMPERATURE = 0.2
TIE_BREAK = 'best-rank'
EXCLUDED_SHOWN = 5
CARRY_NOTE = 'Only earlier questions are carried into a follow-up. Earlier answers are never used as evidence.'


def _ms(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def read_codes(question: str, workspace: Workspace, registry) -> tuple[list[identifiers.Code], str, list[str], dict]:
    """The question's codes, the query retrieval searches (codes written the
    way the manuals write them) and the "Read as …" notes."""
    known = cards.known_codes(workspace)
    skip = [(m['start'], m['end']) for m in registry.resolve(question)['mentions']]
    found = [c for c in identifiers.find(question, skip=skip, known=set(known))
             if c.scheme != 'token' or c.code in known or len(c.code) >= 3]
    query, read_as, offset = question, [], 0
    for code in found:
        if code.code not in known:
            continue
        display = known[code.code][0]
        if code.raw != display:
            # Written another way ("gpio-22", "e 17"): search for the manual's own spelling.
            read_as.append(display)
            start, end = code.start + offset, code.end + offset
            query = query[:start] + display + query[end:]
            offset += len(display) - (end - start)
    return found, query, list(dict.fromkeys(read_as)), known


def follow_up(message: str, earlier: list[str], choice, model) -> dict:
    """Decide whether ``message`` continues the conversation, and build the
    query retrieval runs. ``choice`` is True, False or 'auto'."""
    questions = [{'role': 'user', 'content': q} for q in earlier]
    detected = bool(earlier) and (is_followup(message) or needs_rewrite(message, questions))
    following = bool(earlier) and (detected if choice == 'auto' else bool(choice))
    if not following:
        return {'query': message, 'method': 'none', 'followUp': False, 'detected': detected, 'carried': [],
                'note': CARRY_NOTE}
    if model is not None:
        rewrite = rewrite_query(model, questions, message)
        if rewrite['method'] == 'model':
            return {**rewrite, 'followUp': True, 'detected': detected, 'carried': earlier, 'note': CARRY_NOTE}
        failed = {'error': rewrite.get('error'), 'ms': rewrite.get('ms', 0.0)}
    else:
        failed = {'ms': 0.0}
    return {'query': f'{earlier[0]}\nFollow-up: {message}', 'method': 'first question + follow-up',
            'followUp': True, 'detected': detected, 'carried': earlier[:1], 'note': CARRY_NOTE, **failed}


def _model_ref(registry, model_id: str | None) -> dict | None:
    if not model_id or model_id not in registry.models:
        return None
    definition = registry.models[model_id]
    return {'id': model_id, 'name': definition['name'], 'short': definition.get('short') or definition['name']}


def _revision_ref(registry, model_id: str | None, revision_id: str | None) -> dict | None:
    if not model_id or not revision_id or model_id not in registry.models:
        return None
    return next(({'id': r['id'], 'label': r['label']} for r in registry.models[model_id].get('revisions', [])
                 if r['id'] == revision_id), None)


def run_turn(workspace: Workspace, message: str, *, picker_model: str | None, picker_revision: str | None,
             mode: str, options: dict, model, embedder: Embedder | None, model_info: dict,
             earlier: list[str] = (), follow='auto', cancelled: Callable[[], bool] = lambda: False) -> Iterator[dict]:
    started = perf_counter()
    timings: dict[str, float] = {}
    settings = workspace.preferences()
    library = workspace.library
    registry = library.registry()
    earlier = [q for q in earlier if q.strip()][-MAX_EARLIER:]

    result = {'type': 'done', 'status': 'clarification', 'answer': None, 'citations': [], 'sources': [],
              'safetyNotes': [], 'card': None, 'model': None, 'revision': None, 'readAs': [],
              'explanation': None, 'generation': None, 'excluded': None, 'clarification': None,
              'conversation': {'topic': [*earlier, message], 'followUp': False}, 'timings': timings}

    # 1. Identify --------------------------------------------------------
    yield {'type': 'stage', 'stage': 'identify'}
    identify_started = perf_counter()
    rewrite = follow_up(message, earlier, follow, model if earlier else None)
    timings['rewriteMs'] = rewrite.get('ms', 0.0)
    codes, query, read_as, known = read_codes(rewrite['query'], workspace, registry)
    found = cards.entries(workspace) if codes else []
    decided = clarify.resolve(message, picker_model, picker_revision, registry, library, query,
                              with_code=cards.models_with_code(found, codes, registry))
    if (decided['clarification'] or {}).get('reason') == 'no_model' and rewrite['followUp']:
        # A follow-up that names no model keeps the one model its conversation named.
        earlier_named = registry.resolve(' '.join(earlier))
        if len(earlier_named['models']) == 1:
            kept = earlier_named['models'][0]
            decided = {**decided, 'model': kept, 'revision': earlier_named['revisions'].get(kept),
                       'source': 'question', 'clarification': None}
    model_id, revision_id = decided['model'], decided['revision']
    if model_id is not None and revision_id is None and not decided['clarification']:
        # A code that differs between the model's revisions, or that only some
        # of them have: ask which revision before showing its card.
        for code in codes:
            hits = [e for e in cards.for_model(found, model_id) if e['code'] == code.code]
            asked = clarify.code_revision_question(model_id, hits, registry, message,
                                                   known.get(code.code, (code.display,))[0])
            if asked:
                decided = {**decided, 'clarification': asked}
                break
    identify = {
        'question': message, 'query': query, 'readAs': read_as, 'mentions': decided['mentions'],
        'codes': [{'raw': c.raw, 'code': c.code, 'display': known.get(c.code, (c.display,))[0], 'scheme': c.scheme,
                   'start': c.start, 'end': c.end, 'known': c.code in known} for c in codes],
        'picker': {'model': picker_model, 'revision': picker_revision},
        'chosen': {'model': model_id, 'revision': revision_id, 'source': decided['source']},
        'rewrite': rewrite, 'ms': _ms(identify_started),
    }
    timings['identifyMs'] = identify['ms']
    yield {'type': 'identify', 'trace': identify}
    result.update(readAs=read_as, model=_model_ref(registry, model_id),
                  revision=_revision_ref(registry, model_id, revision_id),
                  conversation={'topic': [*(earlier if rewrite['followUp'] else []), message],
                                'followUp': rewrite['followUp']})
    if decided['clarification']:
        timings['totalMs'] = _ms(started)
        yield {'type': 'clarification', 'clarification': decided['clarification']}
        yield {**result, 'status': 'clarification', 'clarification': decided['clarification']}
        return

    # 2. Card ------------------------------------------------------------
    card = None
    pinned: list[str] = []
    if model_id is not None:
        for code in cards.most_specific(codes, found):
            card = cards.card(workspace, registry, code, model_id, revision_id)
            if card is not None:
                break
        if card is not None:
            yield {'type': 'card', 'card': card}
            if card['kind'] == 'found':
                pinned = [card['chunkId']]
    result['card'] = card

    # 3. Retrieval -------------------------------------------------------
    yield {'type': 'stage', 'stage': 'retrieval'}
    allowed = library.allowed(model_id, revision_id)
    trace = retrieve(library, query, mode=mode, k=options['k'], embedder=embedder, allowed=allowed,
                     constant=options['rrfConstant'], tie_break=TIE_BREAK)
    every = set(library.chunks())
    trace.update(original=message, rewrite=rewrite,
                 filter={'model': model_id, 'revision': revision_id,
                         'allowed': len(allowed) if allowed is not None else len(every),
                         'excluded': len(every - allowed) if allowed is not None else 0},
                 # Nearest-by-meaning passages are returned even when nothing matches a word.
                 weak=bool(trace['selected']) and not trace['keyword']['results'])
    timings['retrievalMs'] = trace['ms']
    yield {'type': 'retrieval', 'trace': trace}

    excluded = None
    if allowed is not None and every - allowed:
        others = retrieve(library, query, mode=mode, k=EXCLUDED_SHOWN, embedder=embedder,
                          allowed=every - allowed, constant=options['rrfConstant'], tie_break=TIE_BREAK)
        chunks = library.chunks()
        others_ids = [cid for cid in others['selected'] if cid in chunks]
        if others_ids:
            excluded = {'count': len([r for r in others['fused']['results']]), 'items': [{
                'id': cid, 'docName': chunks[cid]['docName'], 'title': chunks[cid]['title'],
                'text': chunks[cid]['text'], 'location': chunks[cid]['location'], 'rank': rank,
                'models': [ref for ref in (_model_ref(registry, m) for m in (chunks[cid]['models']
                                                                             if chunks[cid]['models'] is not None
                                                                             else chunks[cid]['docModels'])) if ref],
            } for rank, cid in enumerate(others_ids, 1)]}
            yield {'type': 'excluded', 'excluded': excluded}
    result['excluded'] = excluded

    if model_id is not None and revision_id is None and not (card and card['kind'] == 'found'):
        # (An exact code match already says which passage is meant.)
        chunks = library.chunks()
        found = [(chunks[c]['revisions'].get(model_id), chunks[c]['text'])
                 for c in [*pinned, *trace['selected']] if c in chunks]
        asked = clarify.revision_question(model_id, found, registry, message)
        if asked:
            timings['totalMs'] = _ms(started)
            yield {'type': 'clarification', 'clarification': asked}
            yield {**result, 'status': 'clarification', 'clarification': asked}
            return

    # 4. Context ---------------------------------------------------------
    yield {'type': 'stage', 'stage': 'context'}
    labels = {r['id']: r['label'] for r in registry.models.get(model_id, {}).get('revisions', [])} if model_id else {}
    context = context_layer.build(workspace, trace['selected'], model=model_id, revision=revision_id,
                                  budget=options['budgetWords'], pinned=pinned, revision_labels=labels)
    items = context['items']
    model_def = registry.models.get(model_id) if model_id else None
    revision_def = _revision_ref(registry, model_id, revision_id)
    messages, prompt = build_prompt(message, items, rewrite.get('carried', []), settings, model_def, revision_def)
    context.update(prompt=prompt, safetyNotes=context_layer.safety_notes(query, items, registry, model_id))
    timings['contextMs'] = round(context['ms'] + prompt['ms'], 2)
    yield {'type': 'context', 'trace': context}
    result.update(sources=items, safetyNotes=context['safetyNotes'])

    generation = {**model_info, 'parameters': {'temperature': TEMPERATURE, 'max_tokens': ANSWER_TOKENS, 'stream': True},
                  'attempts': [], 'reasoning': '', 'rawAnswer': '', 'usage': {}, 'finishReason': None,
                  'timings': {}, 'citations': {'valid': [], 'invalid': []}, 'error': None}
    result['generation'] = generation

    if not items:
        timings['totalMs'] = _ms(started)
        generation['error'] = "Nothing in this model's manual matched, so no model was asked."
        yield {**result, 'status': 'no_passages'}
        return
    if model is None:
        timings['totalMs'] = _ms(started)
        generation['error'] = "No model key is configured, so the manual's own sentences are shown instead."
        yield {**result, 'status': 'sources_only', 'explanation': context_layer.verbatim(query, items, registry, model_id)}
        return

    # 5. Generation ------------------------------------------------------
    yield {'type': 'stage', 'stage': 'generation'}
    generation_started = perf_counter()
    answer: list[str] = []
    reasoning: list[str] = []
    error = None
    stream = model.stream(messages, max_tokens=ANSWER_TOKENS, temperature=TEMPERATURE)
    try:
        for event in stream:
            if cancelled():
                error = 'Stopped.'
                break
            kind = event['type']
            if kind == 'attempt':
                generation['attempts'].append({'model': event['model'], 'attempt': event['attempt'], 'ok': None})
                yield {'type': 'generation.attempt', 'model': event['model'], 'attempt': event['attempt']}
            elif kind == 'retry':
                generation['attempts'][-1].update(ok=False, reason=event['reason'])
                reasoning.clear()
                yield {'type': 'generation.retry', 'model': event['model'], 'attempt': event['attempt'],
                       'reason': event['reason']}
            elif kind == 'reasoning':
                generation['timings'].setdefault('firstReasoningMs', _ms(generation_started))
                reasoning.append(event['delta'])
                yield {'type': 'reasoning', 'delta': event['delta']}
            elif kind == 'token':
                generation['timings'].setdefault('firstTokenMs', _ms(generation_started))
                answer.append(event['delta'])
                yield {'type': 'token', 'delta': event['delta']}
            elif kind == 'end':
                generation['attempts'][-1]['ok'] = True
                generation.update(model=event['model'], usage=event['usage'], finishReason=event['finish_reason'])
    except ProviderError as failure:
        error = str(failure)
        if generation['attempts'] and generation['attempts'][-1]['ok'] is None:
            generation['attempts'][-1].update(ok=False, reason=error)
    finally:
        stream.close()

    raw = ''.join(answer)
    generation.update(reasoning=''.join(reasoning), rawAnswer=raw, error=error)
    generation['timings']['totalMs'] = _ms(generation_started)
    timings['generationMs'] = generation['timings']['totalMs']
    if error and not raw:
        # The manual's own sentences stand in for the answer that did not arrive.
        result.update(status='unavailable', explanation=context_layer.verbatim(query, items, registry, model_id))
    else:
        text, valid, invalid = parse_citations(raw, len(items))
        generation['citations'] = {'valid': valid, 'invalid': invalid}
        result.update(answer=text, citations=[{'n': n, 'id': items[n - 1]['id']} for n in valid])
        if error:
            result['status'] = 'interrupted'
        elif text.startswith(settings['notFound']):
            result['status'] = 'not_found'
        else:
            result['status'] = 'answered' if valid else 'uncited'
    timings['totalMs'] = _ms(started)
    yield result
