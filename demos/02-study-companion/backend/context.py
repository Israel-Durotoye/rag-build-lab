"""The context layer: turn retrieved chunks into what the model reads.

A retrieved chunk can be a fragment. ``rag_core.study.build_context`` swaps a
small fragment for its whole parent section when that fits the word budget,
adds sections in rank order, and records what the budget left out. This
module numbers the result, pulls out the notes' own caveats, and picks the
verbatim sentences shown when no model is configured.
"""
from __future__ import annotations

import re
from time import perf_counter

from rag_core.core import tokens
from rag_core.study import EXTRACTIVE_LABEL, SENTENCE, build_context, extract

from .store import ChunkView, Workspace

# Words that qualify a statement. The strong ones mark an exception outright,
# as opposed to a plain "not" or "but", and are preferred when there are many.
STRONG = ('except', 'exception', 'unless', 'only if', 'however', 'cannot', 'never', 'warning', 'caution')
WEAK = ('not', 'but')
STRONG_QUALIFIER = re.compile(r'\b(' + '|'.join(STRONG) + r')\b', re.I)
QUALIFIER = re.compile(r'\b(' + '|'.join(STRONG + WEAK) + r')\b', re.I)
MAX_CAVEATS = 3


def build(view: ChunkView, workspace: Workspace, selected: list[str], *, budget: int, expand_below: int,
          expand: bool) -> dict:
    """Numbered context items plus how the budget was spent."""
    started = perf_counter()
    chunks = [chunk for chunk in (view.index.source(cid) for cid in selected) if chunk is not None]
    items, spent = build_context(chunks, workspace.documents(), budget, expand_below, expand)
    records = workspace.records()
    names = {r['id']: r['name'] for r in records}
    sizes = {(r['id'], s['id']): s['words'] for r in records for s in r['sections']}
    return {
        'items': [{
            'n': n, 'id': item['id'], 'docId': item['doc_id'], 'docName': names.get(item['doc_id'], item['doc_id']),
            'sectionId': item['section_id'], 'title': item['title'], 'location': item['location'],
            'text': item['text'], 'words': item['words'],
            'sectionWords': sizes.get((item['doc_id'], item['section_id']), item['words']),
            'expanded': item['expanded'],
            'matchedChunkIds': item['matched_chunk_ids'], 'contentHash': item['metadata']['content_hash'],
        } for n, item in enumerate(items, 1)],
        'budget': {'budgetWords': spent['budget_words'], 'usedWords': spent['used_words'],
                   'overBudget': spent['over_budget'], 'expandBelowWords': spent['expand_below_words'],
                   'expansion': spent['expansion_enabled'],
                   'skipped': [{'chunkId': s['chunk_id'], 'reason': s['reason']} for s in spent['skipped']]},
        'chunking': view.chunking,
        'corpusVersion': view.index.version,
        'ms': round((perf_counter() - started) * 1000, 2),
    }


def caveats(query: str, items: list[dict]) -> list[dict]:
    """Verbatim sentences from the context that qualify the topic asked about
    ("does not", "unless", "except") and share words with the question. They
    are shown beside every answer, so a caveat in the notes stays visible
    whatever the explanation says."""
    terms = set(tokens(query))
    # One shared word is enough for a one-word question; otherwise two, so a
    # sentence that merely mentions the subject is not held up as a caveat.
    needed = min(2, len(terms))
    found = []
    for position, item in enumerate(items):
        for index, sentence in enumerate(s.strip() for s in SENTENCE.split(item['text']) if s.strip()):
            if not QUALIFIER.search(sentence):
                continue
            overlap = len(terms & set(tokens(sentence)))
            if not overlap or overlap < needed:
                continue
            score = overlap + (2 if STRONG_QUALIFIER.search(sentence) else 0)
            found.append((-score, position, index, sentence, item['n']))
    chosen = sorted(sorted(found)[:MAX_CAVEATS], key=lambda c: (c[1], c[2]))
    return [{'text': sentence, 'n': n} for _, _, _, sentence, n in chosen]


def verbatim(query: str, items: list[dict]) -> dict | None:
    """The offline explanation: sentences copied from the context, never
    written by a model."""
    if not items:
        return None
    numbers = {item['id']: item['n'] for item in items}
    return {'kind': 'extractive', 'label': EXTRACTIVE_LABEL,
            'sentences': [{'text': s['text'], 'n': numbers[s['source_id']]} for s in extract(query, items)]}
