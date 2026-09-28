"""One chat turn through the whole RAG pipeline, as a stream of events:

    stage/rewrite → retrieval → augmentation → generation (reasoning, tokens) → done

Every layer's trace goes to the client, which shows it on its own tab.
"""
from __future__ import annotations

from time import perf_counter
from typing import Callable, Iterator

from rag_core.providers import ProviderError

from .augmentation import build_prompt, clean_history, guide_settings
from .embeddings import Embedder
from .generation import is_overview_question, needs_rewrite, parse_citations, rewrite_query
from .retrieval import retrieve
from .store import Workspace

ANSWER_TOKENS = 4000
TEMPERATURE = 0.2


def _ms(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def run_turn(workspace: Workspace, message: str, history: list[dict], *, model, embedder: Embedder | None,
             mode: str, k: int, model_info: dict, document_ids: list[str] | None,
             cancelled: Callable[[], bool]) -> Iterator[dict]:
    started = perf_counter()
    history = clean_history(history)
    timings: dict[str, float] = {}

    rewrite = {'query': message, 'method': 'none'}
    if needs_rewrite(message, history):
        yield {'type': 'stage', 'stage': 'rewrite'}
        rewrite = rewrite_query(model, history, message)
    timings['rewriteMs'] = rewrite.get('ms', 0.0)

    yield {'type': 'stage', 'stage': 'retrieval'}
    retrieval = retrieve(workspace, rewrite['query'], mode=mode, k=k, embedder=embedder, document_ids=document_ids)
    retrieval.update(original=message, rewrite=rewrite, strategy='search')
    if is_overview_question(message):
        # "What is this document about?" is answered best by each document's
        # opening pages, which a search for the words "document" won't find.
        opening: list[str] = []
        chunks = workspace.chunks()
        for record in workspace.records():
            if document_ids and record['id'] not in document_ids:
                continue
            opening.extend(f"{record['id']}:{c['id']}:0" for c in record['chunks'][:3])
        selected = list(dict.fromkeys(opening + retrieval['selected']))[:max(k, len(opening))]
        retrieval['chunks'].update({cid: chunks[cid] for cid in selected})
        retrieval.update(selected=selected, strategy='document opening + search')
    timings['retrievalMs'] = retrieval['ms']
    yield {'type': 'retrieval', 'trace': retrieval}
    passages = [{**retrieval['chunks'][cid], 'n': n} for n, cid in enumerate(retrieval['selected'], 1)]

    yield {'type': 'stage', 'stage': 'augmentation'}
    names = [r['name'] for r in workspace.records() if not document_ids or r['id'] in document_ids]
    guide = guide_settings(workspace.settings())
    messages, augmentation = build_prompt(message, passages, history, names, guide)
    timings['augmentationMs'] = augmentation['ms']
    yield {'type': 'augmentation', 'trace': augmentation}

    generation = {**model_info, 'parameters': {'temperature': TEMPERATURE, 'max_tokens': ANSWER_TOKENS, 'stream': True},
                  'attempts': [], 'reasoning': '', 'rawAnswer': '', 'usage': {}, 'finishReason': None,
                  'timings': {}, 'citations': {'valid': [], 'invalid': []}, 'error': None}
    if model is None:
        timings['totalMs'] = _ms(started)
        generation['error'] = 'No model key is configured, so the retrieved passages are shown instead.'
        yield {'type': 'done', 'status': 'sources_only', 'answer': None, 'citations': [], 'sources': passages,
               'generation': generation, 'timings': timings}
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
        status, text, citations = 'unavailable', None, []
    else:
        text, valid, invalid = parse_citations(raw, len(passages))
        generation['citations'] = {'valid': valid, 'invalid': invalid}
        citations = [{'n': n, 'id': passages[n - 1]['id']} for n in valid]
        if error:
            status = 'interrupted'
        elif text.startswith(guide['notFound']):
            status = 'not_found'
        elif valid:
            status = 'answered'
        else:
            status = 'uncited' if passages else 'no_passages'
    timings['totalMs'] = _ms(started)
    yield {'type': 'done', 'status': status, 'answer': text, 'citations': citations, 'sources': passages,
           'generation': generation, 'timings': timings}
