"""Which model (and revision) a question is about, and when to ask.

Finder never guesses between look-alike models:

1. A model named in the question is used, unless the picker has chosen a
   different one (Finder asks which: "conflict") or the name fits more than
   one model ("Pi 3" when the library has the 3B and the 3B+: "ambiguous_name").
2. Otherwise the model chosen in the picker is used.
3. With neither, Finder always asks ("no_model"). The choices are every model
   in the library. Those whose manuals have the question's code come first,
   marked ``matched``; for a question without a known code, those whose
   passages contain words of the question. What each manual says is not shown.
4. When the chosen model has revisions, none is chosen, and the passages found
   for the question hold revision-specific text for two or more revisions that
   disagree, Finder asks which revision ("revision").

The disagreement rule: two passages agree when their text is the same once
every model, family and revision name is removed and case, punctuation and
spacing are ignored. So "The 3B needs 2.5A" and "The 3B+ needs 2.5A" agree;
"GPIO 22 selects SD0" and "GPIO 22 selects NAND" do not.
"""
from __future__ import annotations

import re

from .variants import Registry, applies

MATCH_POOL = 40


def comparable(text: str, registry: Registry) -> str:
    """A passage reduced to what the disagreement rule compares."""
    return ' '.join(re.sub(r'[^0-9a-z]+', ' ', registry.strip(text).lower()).split())


def agree(texts: list[str], registry: Registry) -> bool:
    return len({comparable(t, registry) for t in texts}) <= 1


def _ref(model: dict, matched: bool) -> dict:
    return {'id': model['id'], 'name': model['name'], 'short': model.get('short') or model['name'],
            'family': model.get('family'), 'matched': matched, 'kind': 'model'}


def matched_models(library, query: str) -> list[str]:
    """Models whose passages contain words of the question, best match first
    (unfiltered keyword search; used only to order the choices)."""
    chunks = library.chunks()
    order: list[str] = []
    for hit in library.index.keyword_matches(query, limit=MATCH_POOL):
        chunk = chunks.get(hit['chunk'].id)
        if chunk is None:
            continue
        for model in chunk['models'] if chunk['models'] is not None else chunk['docModels']:
            if model not in order:
                order.append(model)
    return order


def choices(registry: Registry, matched: list[str], only: list[str] | None = None) -> list[dict]:
    models = [registry.models[m] for m in (only or list(registry.models)) if m in registry.models]
    first = [m for m in matched if any(x['id'] == m for x in models)]
    ordered = sorted(models, key=lambda m: (first.index(m['id']) if m['id'] in first else len(first), m['name']))
    return [_ref(m, m['id'] in first) for m in ordered]


def resolve(question: str, picker_model: str | None, picker_revision: str | None, registry: Registry,
            library, query: str, with_code: list[str] = ()) -> dict:
    """The model to answer for, or the question to ask instead.

    ``with_code`` lists the models whose manuals have the question's code
    (cards.models_with_code); they are the choices marked as matching.

    Returns {'model', 'revision', 'source': 'question' | 'picker' | 'none',
    'clarification': dict | None, 'mentions': [...]}"""
    def matched(only: list[str] | None = None) -> list[str]:
        hits = [m for m in with_code if only is None or m in only]
        return hits or matched_models(library, query)

    found = registry.resolve(question)
    named = found['models']
    picker = picker_model if picker_model in registry.models else None
    revision = picker_revision if picker and picker_revision in {
        r['id'] for r in registry.models[picker].get('revisions', [])} else None
    result = {'model': None, 'revision': None, 'source': 'none', 'clarification': None,
              'mentions': found['mentions']}

    if not registry.models:
        # A library without models: nothing to filter by, so nothing to ask.
        return result
    if len(named) > 1:
        # A family that fits one model here ("Raspberry Pi 2": only the 2B) is that model.
        alias = next((m['alias'] for m in found['mentions'] if m['kind'] in {'family', 'model'}), question)
        result['clarification'] = {
            'reason': 'ambiguous_name',
            'message': f'“{alias}” could mean more than one model. Which one is it?',
            'question': question,
            'candidates': choices(registry, matched(named), named),
        }
        return result
    if named:
        model = named[0]
        if picker and picker != model:
            result['clarification'] = {
                'reason': 'conflict',
                'message': (f"You asked about the {registry.models[model]['name']}, but you're working on the "
                            f"{registry.models[picker]['name']}. Which one is it?"),
                'question': question,
                'candidates': choices(registry, [model, picker], [model, picker]),
            }
            return result
        asked_revision = found['revisions'].get(model)
        return {**result, 'model': model, 'source': 'question',
                'revision': asked_revision or (revision if picker == model else None)}
    if picker:
        return {**result, 'model': picker, 'revision': revision, 'source': 'picker'}
    result['clarification'] = {
        'reason': 'no_model',
        'message': "Which model is this for? Finder answers from one model's manual at a time, so it won't guess.",
        'question': question,
        'candidates': choices(registry, matched()),
    }
    return result


def revision_question(model: str, passages: list[tuple[list[str] | None, str]], registry: Registry,
                      question: str) -> dict | None:
    """Ask which revision when ``passages`` — (the model's revisions a
    passage applies to, its text) — hold revision-specific text for two or
    more of the model's revisions and that text disagrees."""
    definition = registry.models.get(model)
    if not definition or not definition.get('revisions'):
        return None
    by_revision: dict[str, list[str]] = {}
    for allowed, text in passages:
        if allowed is None or len(allowed) == len(definition['revisions']):
            continue
        for revision in allowed:
            by_revision.setdefault(revision, []).append(text)
    if len(by_revision) < 2:
        return None
    texts = [' '.join(sorted(comparable(t, registry) for t in found)) for found in by_revision.values()]
    if len(set(texts)) <= 1:
        return None
    labels = {r['id']: r for r in definition['revisions']}
    return {
        'reason': 'revision',
        'message': f"The {definition['name']}'s revisions differ here. Which revision is it?",
        'question': question,
        'candidates': [{'id': r['id'], 'name': r['label'], 'short': r['label'], 'family': definition.get('family'),
                        'matched': r['id'] in by_revision, 'kind': 'revision', 'modelId': model}
                       for r in labels.values()],
    }


# A table with one of these columns names each row's revision itself.
REVISION_COLUMNS = {'revision', 'rev', 'rev.', 'version', 'board revision'}


def code_revision_question(model: str, hits: list[dict], registry: Registry, question: str,
                           display: str) -> dict | None:
    """Before a code's card is shown for a model with no revision chosen, ask
    which revision when the revisions read the code differently
    (revision_question), or when only some of them have it at all: GPIO 20
    is a boot pin in the table of the 3B with the BCM2837B0, not in the
    original BCM2837's. A row of a revision-code table ("a01041 | 2B | 1.1")
    names its own revision, so it never asks."""
    asked = revision_question(model, [(e['revisions'].get(model), e['meaning']) for e in hits], registry, question)
    definition = registry.models.get(model)
    if asked or not hits or not definition or not definition.get('revisions'):
        return asked
    if any(h.strip().lower() in REVISION_COLUMNS for e in hits for h in (e.get('header') or '').split('|')):
        return None
    allowed = [e['revisions'].get(model) for e in hits]
    if any(a is None for a in allowed):
        return None
    having = {r for a in allowed for r in a}
    revisions = definition['revisions']
    if not having or {r['id'] for r in revisions} <= having:
        return None
    names = ' and '.join(r['label'] for r in revisions if r['id'] in having)
    return {
        'reason': 'revision',
        'message': f"{display} is only in the table for the {names}. Which revision of the "
                   f"{definition['name']} is it?",
        'question': question,
        'candidates': [{'id': r['id'], 'name': r['label'], 'short': r['label'], 'family': definition.get('family'),
                        'matched': r['id'] in having, 'kind': 'revision', 'modelId': model}
                       for r in revisions],
    }


def allowed_ids(library, model: str | None, revision: str | None) -> set[str] | None:
    return library.allowed(model, revision)


def unit_applies(chunk: dict, model: str, revision: str | None) -> bool:
    return applies({'models': chunk['models'], 'revisions': chunk['revisions']}, chunk['docModels'], model, revision)
