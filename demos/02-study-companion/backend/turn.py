"""One question through the whole pipeline, as a stream of events:

    stage/follow-up → retrieval → context → generation (reasoning, tokens) → done

Every layer's trace goes to the client, which shows it on its own page.
"""
from __future__ import annotations

from time import perf_counter
from typing import Callable, Iterator

from rag_core.providers import ProviderError
from rag_core.study import is_followup
from rag_core.web.answers import needs_rewrite, parse_citations, rewrite_query
from rag_core.web.embeddings import Embedder
from rag_core.web.retrieval import retrieve

from . import context as context_layer
from .preferences import preferences
from .prompting import MAX_EARLIER, build_prompt
from .store import Workspace

ANSWER_TOKENS = 4000
TEMPERATURE = 0.2
CARRY_NOTE = 'Only earlier questions are carried into a follow-up. Earlier answers are never used as evidence.'


def _ms(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def follow_up(message: str, earlier: list[str], choice, model) -> dict:
    """Decide whether ``message`` continues the topic, and build the query
    that retrieval runs. ``choice`` is True, False or 'auto'."""
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
    # Without a model the topic's first question is sent along with the
    # follow-up, as the command-line demo does.
    return {'query': f'{earlier[0]}\nFollow-up: {message}', 'method': 'topic question + follow-up',
            'followUp': True, 'detected': detected, 'carried': earlier[:1], 'note': CARRY_NOTE, **failed}


def run_turn(workspace: Workspace, message: str, *, earlier: list[str], follow, chunking: str, mode: str,
             expand: bool, options: dict, model, embedder: Embedder | None, model_info: dict,
             document_ids: list[str] | None, cancelled: Callable[[], bool]) -> Iterator[dict]:
    started = perf_counter()
    timings: dict[str, float] = {}
    settings = preferences(workspace.settings())
    earlier = [q for q in earlier if q.strip()][-MAX_EARLIER:]

    if earlier and follow is not False:
        yield {'type': 'stage', 'stage': 'rewrite'}
    rewrite = follow_up(message, earlier, follow, model)
    timings['rewriteMs'] = rewrite.get('ms', 0.0)
    carried = earlier if rewrite['followUp'] else []
    topic = [*carried, message]

    yield {'type': 'stage', 'stage': 'retrieval'}
    view = workspace.views[chunking]
    retrieval = retrieve(view, rewrite['query'], mode=mode, k=options['k'], embedder=embedder,
                         document_ids=document_ids)
    retrieval.update(original=message, rewrite=rewrite, chunking=chunking,
                     chunkWords=options['chunkWords'] if chunking == 'fixed' else None,
                     # Nearest-by-meaning sections are returned even when nothing matches a word.
                     weak=bool(retrieval['selected']) and not retrieval['keyword']['results'])
    timings['retrievalMs'] = retrieval['ms']
    yield {'type': 'retrieval', 'trace': retrieval}

    yield {'type': 'stage', 'stage': 'context'}
    context = context_layer.build(view, workspace, retrieval['selected'], budget=options['budgetWords'],
                                  expand_below=options['expandBelowWords'], expand=expand)
    items = context['items']
    names = [r['name'] for r in workspace.records() if not document_ids or r['id'] in document_ids]
    messages, prompt = build_prompt(message, items, carried, names, settings)
    context.update(prompt=prompt, caveats=context_layer.caveats(rewrite['query'], items))
    timings['contextMs'] = round(context['ms'] + prompt['ms'], 2)
    yield {'type': 'context', 'trace': context}

    generation = {**model_info, 'parameters': {'temperature': TEMPERATURE, 'max_tokens': ANSWER_TOKENS, 'stream': True},
                  'attempts': [], 'reasoning': '', 'rawAnswer': '', 'usage': {}, 'finishReason': None,
                  'timings': {}, 'citations': {'valid': [], 'invalid': []}, 'error': None}
    result = {'type': 'done', 'answer': None, 'citations': [], 'sources': items, 'caveats': context['caveats'],
              'explanation': None, 'conversation': {'topic': topic, 'followUp': rewrite['followUp']},
              'generation': generation, 'timings': timings}

    if not items:
        timings['totalMs'] = _ms(started)
        generation['error'] = 'Nothing in the notes matched, so no model was asked.'
        yield {**result, 'status': 'no_passages'}
        return
    if model is None:
        timings['totalMs'] = _ms(started)
        generation['error'] = 'No model key is configured, so sentences from the notes are shown instead.'
        yield {**result, 'status': 'sources_only', 'explanation': context_layer.verbatim(rewrite['query'], items)}
        return

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
        # The notes' own sentences stand in for the answer that did not arrive.
        result.update(status='unavailable', explanation=context_layer.verbatim(rewrite['query'], items))
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
