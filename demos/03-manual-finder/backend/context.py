"""The context layer: turn retrieved passages into what the model reads.

A retrieved unit is often one row or one paragraph. Each becomes its whole
section *as the chosen model sees it*: the section's passages for that model
(and revision), in order, within a word budget. Passages for other models are
removed before the model reads anything; they are kept in the trace, marked
``masked``, so the interface can show them greyed. Several matches in one
section share one context item.

The manual's own warnings are picked out by rule and shown beside every
answer, and when no model is configured the reply is built from the manual's
own sentences instead.
"""
from __future__ import annotations

import re
from time import perf_counter

from rag_core.core import tokens
from rag_core.study import EXTRACTIVE_LABEL, SENTENCE, extract

from .store import chunk_id
from .variants import applies

WARNING = re.compile(r"\b(warning|caution|danger|do not|don't|never|must not|cannot be undone|permanent(?:ly)?|"
                     r'risk|damage|injur\w*|shock|hot|burn\w*|unplug|disconnect|power off|irreversible)\b', re.I)
MAX_SAFETY_NOTES = 3
EXTRACTIVE = EXTRACTIVE_LABEL.replace('supporting sections', "manual's passages")


def _words(text: str) -> int:
    return len(text.split())


def _render(units: list[dict], only: dict[str, str] | None = None) -> str:
    """The text of a run of units, with a table's header line written once.
    ``only`` maps a unit ID to a note such as "(Only v1.2) ", put before a
    line that applies only to some revisions of the chosen model."""
    lines: list[str] = []
    header = None
    for unit in units:
        note = (only or {}).get(unit['id'], '')
        if unit['kind'] == 'row' and unit.get('header') and '\n' in unit['text']:
            head, row = unit['text'].split('\n', 1)
            if head != header:
                lines.append(head)
                header = head
            lines.append(note + row)
        else:
            header = None
            lines.append(note + unit['text'])
    return '\n'.join(lines)


def revision_notes(units: list[dict], model: str | None, revision: str | None,
                   labels: dict[str, str]) -> dict[str, str]:
    """With a model chosen but no revision, the lines that apply to only some
    of its revisions, each with a note naming them: "(Only v1.2) "."""
    if model is None or revision is not None or len(labels) < 2:
        return {}
    notes = {}
    for unit in units:
        allowed = (unit.get('revisions') or {}).get(model)
        if allowed and len(set(allowed)) < len(labels):
            notes[unit['id']] = '(Only ' + ', '.join(labels.get(r, r) for r in allowed) + ') '
    return notes


# The word budget also bounds characters: one "word" can be any length.
CHARS_PER_WORD = 12


def build(workspace, matched: list[str], *, model: str | None, revision: str | None, budget: int,
          pinned: list[str] = (), revision_labels: dict[str, str] | None = None) -> dict:
    """Numbered context items (``pinned`` first, then ``matched`` in rank
    order) and how the budget was spent."""
    started = perf_counter()
    chunks = workspace.library.chunks()
    order: list[tuple[str, str]] = []
    hits: dict[tuple[str, str], list[str]] = {}
    for cid in [*pinned, *(c for c in matched if c not in pinned)]:
        chunk = chunks.get(cid)
        if chunk is None:
            continue
        key = (chunk['docId'], chunk['sectionId'])
        if key not in hits:
            order.append(key)
            hits[key] = []
        hits[key].append(cid)

    items, skipped, used, used_chars, masked_total = [], [], 0, 0, 0
    char_budget = budget * CHARS_PER_WORD
    for key in order:
        doc_id, section_id = key
        record = workspace.record(doc_id)
        if record is None:
            continue
        section = next((s for s in record['sections'] if s['id'] == section_id), None)
        units = {u['id']: u for u in record['units']}
        members = [units[u] for u in (section['unitIds'] if section else []) if u in units]
        matched_ids = {chunks[c]['unitId'] for c in hits[key]}
        view, masked = [], []
        for unit in members:
            fits = model is None or applies(unit, record['models'], model, revision)
            (view if fits else masked).append(unit)
        room = budget - used
        partial = False
        if _words(_render(view)) > room:
            # Keep the matched passages and grow outwards while there is room.
            positions = [i for i, u in enumerate(view) if u['id'] in matched_ids]
            if not positions:
                continue
            chosen = {positions[0]}
            for position in positions[1:]:
                if _words(_render([view[i] for i in sorted(chosen | {position})])) <= room:
                    chosen.add(position)
            low, high = min(chosen), max(chosen)
            while True:
                grown = False
                for candidate in (low - 1, high + 1):
                    if 0 <= candidate < len(view) and _words(_render([view[i] for i in sorted(chosen | {candidate})])) <= room:
                        chosen.add(candidate)
                        low, high = min(chosen), max(chosen)
                        grown = True
                if not grown:
                    break
            included = [view[i] for i in sorted(chosen)]
            partial = True
            if items and _words(_render(included)) > room:
                skipped.extend({'chunkId': c, 'reason': 'the section would exceed the context budget'} for c in hits[key])
                continue
        else:
            included = view
        if not included:
            continue
        text = _render(included, revision_notes(included, model, revision, revision_labels or {}))
        if len(text) > char_budget - used_chars:
            if items:
                skipped.extend({'chunkId': c, 'reason': 'the section would exceed the context budget'}
                               for c in hits[key])
                continue
            # The first passage is always sent, but never beyond the budget.
            text, partial = text[:char_budget].rstrip() + ' …', True
        used += _words(text)
        used_chars += len(text)
        masked_total += len(masked)
        included_ids = {u['id'] for u in included}
        shown = [u for u in members if u['id'] in included_ids or u in masked]
        items.append({
            'n': len(items) + 1,
            'id': hits[key][0],
            'docId': doc_id,
            'docName': record['name'],
            'sectionId': section_id,
            'title': section['title'] if section else record['name'],
            'path': section['path'] if section else [record['name']],
            'location': (units[next(iter(matched_ids))]['location'] if matched_ids else section['location']),
            'text': text,
            'words': _words(text),
            'units': [{'id': u['id'], 'chunkId': chunk_id(doc_id, u['id']), 'text': u['text'],
                       'matched': u['id'] in matched_ids, 'masked': u not in view, 'models': u['models'],
                       'revisions': u.get('revisions', {}), 'kind': u['kind'], 'header': u.get('header')}
                      for u in shown],
            'pinned': any(c in pinned for c in hits[key]),
            'matchedChunkIds': hits[key],
            'partial': partial,
            'source': record.get('source'),
            # An upload whose models aren't confirmed yet counts for every model.
            'unconfirmed': not record.get('modelsConfirmed', True),
        })
    return {
        'items': items,
        'budget': {'budgetWords': budget, 'usedWords': used, 'skipped': skipped},
        'masked': masked_total,
        'ms': round((perf_counter() - started) * 1000, 2),
    }


# The "(Only …)" note the context puts before a line for some revisions. A
# label may hold brackets of its own ("BCM2837 (original)").
NOTE = re.compile(r'^\(Only ((?:[^()\n]|\([^()\n]*\))*)\) ')


def manual_lines(item: dict) -> list[tuple[str, str | None]]:
    """An item's lines as the manual words them, each with the revisions its
    "(Only …)" note names, or None."""
    lines = []
    for line in item['text'].split('\n'):
        note = NOTE.match(line)
        lines.append((line[note.end():], note.group(1)) if note else (line, None))
    return lines


def manual_text(item: dict) -> str:
    """An item's text as the manual words it, without the "(Only …)" notes
    added for the model: quotations shown to people stay verbatim."""
    return ' '.join(text for text, _ in manual_lines(item))


def about_others(sentence: str, registry, model: str | None) -> bool:
    """Whether a sentence names products and none of them is ``model``: "For
    Raspberry Pi 4 and Raspberry Pi 400, we recommend the 3A USB-C Supply"
    inside a passage that also covers the 3B+."""
    if registry is None or model is None:
        return False
    named = [m for m in registry.mentions(sentence) if m.kind != 'revision']
    return bool(named) and not any(model in m.models for m in named)


def sentences(items: list[dict], registry=None, model: str | None = None) -> list[dict]:
    """Every sentence of the items as the manual words it, in reading order,
    with its item's number and the revisions it is limited to ("only"). A
    sentence about other products only is left out."""
    found = []
    for item in items:
        for line_number, (text, only) in enumerate(manual_lines(item)):
            for index, sentence in enumerate(s.strip() for s in SENTENCE.split(text) if s.strip()):
                if not about_others(sentence, registry, model):
                    found.append({'id': f"{item['id']}#{line_number}.{index}", 'text': sentence,
                                  'n': item['n'], 'only': only})
    return found


def safety_notes(query: str, items: list[dict], registry=None, model: str | None = None) -> list[dict]:
    """The manual's own warnings in the context that bear on the question:
    verbatim sentences with a warning word, most relevant first, each with the
    revisions it is limited to. They are shown beside every answer, whatever
    the answer says."""
    terms = set(tokens(query))
    found = []
    for position, sentence in enumerate(sentences(items, registry, model)):
        if not WARNING.search(sentence['text']):
            continue
        overlap = len(terms & set(tokens(sentence['text'])))
        strong = 2 if re.search(r'\b(warning|caution|danger|permanent|cannot be undone)\b', sentence['text'], re.I) else 0
        if overlap == 0 and not strong:
            continue
        found.append((-(overlap + strong), position, sentence))
    chosen = sorted(sorted(found, key=lambda f: (f[0], f[1]))[:MAX_SAFETY_NOTES], key=lambda f: f[1])
    return [{'text': s['text'], 'n': s['n'], 'only': s['only']} for _, _, s in chosen]


def verbatim(query: str, items: list[dict], registry=None, model: str | None = None) -> dict | None:
    """The reply when no model can write one: sentences copied from the
    manual's passages, never written by a model."""
    if not items:
        return None
    pieces = sentences(items, registry, model)
    by_id = {piece['id']: piece for piece in pieces}
    picked = extract(query, pieces)
    # Beside sentences that share two or more words with the question, one
    # that shares a single word ("port" in "the COM port number") is noise.
    terms = set(tokens(query))
    shared = [len(terms & set(tokens(s['text']))) for s in picked]
    if max(shared, default=0) >= 2:
        picked = [s for s, n in zip(picked, shared) if n >= 2]
    return {'kind': 'extractive', 'label': EXTRACTIVE,
            'sentences': [{'text': s['text'], 'n': by_id[s['source_id']]['n'], 'only': by_id[s['source_id']]['only']}
                          for s in picked]}
