"""'Which model do I have?': how to tell a model from its look-alikes, from
the manuals' own words.

For one model: the passages that say how to identify a board (labels,
markings, revision codes, the processor), its revisions, the manuals that
cover it, and, for each look-alike (same family, or a name one or two edits
away), the codes that mean something else and the rows of the same table that
differ. Nothing is drawn or invented; every line is a cited passage.
"""
from __future__ import annotations

import re

from . import cards
from .clarify import comparable
from .identifiers import edit_distance
from .store import Workspace, chunk_id
from .variants import applies, squash

IDENTIFY = re.compile(r'\b(identif\w*|revision code|model number|printed|label\w*|marking\w*|silkscreen|'
                      r'which board|how to tell|/proc/cpuinfo|serial number|ordering code|SKU|processor|'
                      r'microcontroller|\bMCU\b|metal lid|differences?|compared to)\b', re.I)
MAX_IDENTIFY = 8
MAX_FACTS = 12


def _passage(record: dict, unit: dict, sections: dict) -> dict:
    section = sections.get(unit['sectionId'], {})
    return {'chunkId': chunk_id(record['id'], unit['id']), 'docName': record['name'],
            'title': section.get('title', record['name']), 'text': unit['text'], 'location': unit['location']}


def lookalikes(registry, model_id: str) -> list[str]:
    model = registry.models[model_id]
    near = []
    for other in registry.models.values():
        if other['id'] == model_id:
            continue
        same_family = model.get('family') and other.get('family') == model.get('family')
        close = edit_distance(squash(model.get('short') or model['name']),
                              squash(other.get('short') or other['name'])) <= 2
        if same_family or close:
            near.append(other['id'])
    return near


def guide(workspace: Workspace, model_id: str) -> dict | None:
    library = workspace.library
    registry = library.registry()
    if model_id not in registry.models:
        return None
    model = registry.models[model_id]
    records = workspace.records()
    identification, documents = [], []
    for record in records:
        sections = {s['id']: s for s in record['sections']}
        covers = not record['models'] or model_id in record['models']
        if covers:
            documents.append({'id': record['id'], 'name': record['name'], 'source': record.get('source')})
        for unit in record['units']:
            if len(identification) >= MAX_IDENTIFY:
                break
            if unit['models'] is not None and model_id in unit['models'] and IDENTIFY.search(unit['text']):
                identification.append(_passage(record, unit, sections))
    found = cards.entries(workspace)
    lookalike_list = []
    for other in lookalikes(registry, model_id):
        codes = []
        # Every entry counts: on the 3B, GPIO 22 is SD0 on one revision and
        # NAND on the other, and either may differ from the look-alike.
        mine: dict[str, list[dict]] = {}
        theirs: dict[str, list[dict]] = {}
        for entry in cards.for_model(found, model_id):
            mine.setdefault(entry['code'], []).append(entry)
        for entry in cards.for_model(found, other):
            theirs.setdefault(entry['code'], []).append(entry)
        for code in sorted(set(mine) & set(theirs)):
            here = {comparable(e['meaning'], registry): e['meaning'] for e in mine[code]}
            there = {comparable(e['meaning'], registry): e['meaning'] for e in theirs[code]}
            if set(here) != set(there):
                codes.append({'code': code, 'display': mine[code][0]['display'], 'here': ' / '.join(here.values()),
                              'there': ' / '.join(there.values())})
        facts = []
        for record in records:
            sections = {s['id']: s for s in record['sections']}
            rows: dict[tuple[str, str], dict[str, dict]] = {}
            for unit in record['units']:
                if unit['kind'] != 'row' or unit['models'] is None:
                    continue
                for who in (model_id, other):
                    if applies(unit, record['models'], who) and len(unit['models']) == 1:
                        rows.setdefault((unit['sectionId'], unit.get('header') or ''), {})[who] = unit
            for (section_id, header), pair in rows.items():
                if model_id in pair and other in pair and len(facts) < MAX_FACTS:
                    here, there = pair[model_id], pair[other]
                    if comparable(here['text'], registry) != comparable(there['text'], registry):
                        facts.append({'header': header or None, 'title': sections.get(section_id, {}).get('title', ''),
                                      'here': _passage(record, here, sections),
                                      'there': _passage(record, there, sections)})
        definition = registry.models[other]
        lookalike_list.append({'model': {'id': other, 'name': definition['name'],
                                         'short': definition.get('short') or definition['name']},
                               # Every code that differs, not the first twelve by name
                               # (which hid P102: D13 on the UNO R4 WiFi, D5 on the Minima).
                               'codes': codes, 'facts': facts})
    allowed = library.allowed(model_id)
    summary = next((m for m in library_models(workspace) if m['id'] == model_id), None)
    return {
        'model': summary or {**model, 'documents': [d['id'] for d in documents], 'units': len(allowed or []), 'codes': 0},
        'family': registry.families.get(model.get('family')) if model.get('family') else None,
        'documents': documents,
        'identification': identification,
        'lookalikes': lookalike_list,
    }


def library_models(workspace: Workspace) -> list[dict]:
    """Every model with the manuals that cover it and how many passages and
    codes apply to it."""
    library = workspace.library
    registry = library.registry()
    found = cards.entries(workspace)
    records = workspace.records()
    out = []
    for model in registry.models.values():
        allowed = library.allowed(model['id']) or set()
        out.append({**model, 'short': model.get('short') or model['name'],
                    'documents': [r['id'] for r in records if model['id'] in r['models']],
                    'units': len(allowed), 'codes': len({e['code'] for e in cards.for_model(found, model['id'])})})
    return sorted(out, key=lambda m: (m.get('family') or '', m['name']))
