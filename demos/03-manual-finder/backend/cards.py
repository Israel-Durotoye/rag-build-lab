"""Fault cards and the code index.

When a question names a code, the card is read straight from the chosen
model's manual: its row, its meaning, where it is, and which other models
give the same code the same or another meaning. No model writes any of it.
A code the model's manual does not have gets a card that says so, with the
nearest codes it does have.
"""
from __future__ import annotations

from . import identifiers
from .clarify import comparable
from .store import Workspace
from .variants import Registry, applies


def entries(workspace: Workspace) -> list[dict]:
    """Every code entry in the workspace, with its manual's models."""
    found = []
    for record in workspace.records():
        units = {u['id']: u for u in record['units']}
        depth = {s['id']: len(s['path']) for s in record['sections']}
        for entry in record.get('codes', []):
            unit = units.get(entry['unitId'], {})
            found.append({**entry, 'docId': record['id'], 'docName': record['name'], 'docModels': record['models'],
                          'confirmed': record.get('modelsConfirmed', True),
                          'revisions': unit.get('revisions', {}), 'location': unit.get('location', ''),
                          'header': unit.get('header'), 'depth': depth.get(unit.get('sectionId'), 0)})
    return found


def most_specific(codes: list[identifiers.Code], found: list[dict]) -> list[identifiers.Code]:
    """A question's codes, the most specific first: the one with the fewest
    entries in the library ("P102" before the chip name "RA4M1" in "Which pin
    is RA4M1 port P102?"), then in the order they were written. Codes the
    library does not have come next, and last a code that heads a table
    column ("RA4M1" in "Pin | RA4M1 | Timer"): it says where to read the code
    beside it, so "RA4M1 port P120" is about P120, not the chip."""
    counts: dict[str, int] = {}
    for entry in found:
        counts[entry['code']] = counts.get(entry['code'], 0) + 1
    columns = {c.code for header in {e['header'] for e in found if e.get('header')} for c in identifiers.find(header)}
    return sorted(codes, key=lambda c: (c.code in columns, c.code not in counts, counts.get(c.code, 0), c.start))


def known_codes(workspace: Workspace) -> dict[str, tuple[str, str]]:
    """Canonical code → (display, scheme) for every code in the library."""
    known: dict[str, tuple[str, str]] = {}
    for entry in entries(workspace):
        known.setdefault(entry['code'], (entry['display'], entry['scheme']))
    return known


def for_model(found: list[dict], model: str, revision: str | None = None) -> list[dict]:
    return [e for e in found if applies({'models': e['models'], 'revisions': e['revisions']}, e['docModels'],
                                        model, revision)]


def models_with(found: list[dict], code: str, registry: Registry) -> dict[str, list[dict]]:
    """For one code: model → the entries that apply to it."""
    by_model: dict[str, list[dict]] = {}
    for model in registry.models:
        hits = [e for e in for_model(found, model) if e['code'] == code]
        if hits:
            by_model[model] = hits
    return by_model


def models_with_code(found: list[dict], codes: list[identifiers.Code], registry: Registry) -> list[str]:
    """The models whose manuals have the question's most specific code that
    the library knows. When Finder asks which model, these are the choices
    marked as matching the question."""
    for code in most_specific(codes, found):
        with_code = models_with(found, code.code, registry)
        if with_code:
            return list(with_code)
    return []


def _ref(registry: Registry, model: str) -> dict:
    definition = registry.models.get(model, {'id': model, 'name': model})
    return {'id': model, 'name': definition['name'], 'short': definition.get('short') or definition['name']}


def card(workspace: Workspace, registry: Registry, mention: identifiers.Code, model: str,
         revision: str | None) -> dict | None:
    """The fault card for ``mention`` on ``model``, or None when the code is
    unknown everywhere and nothing near it exists (then it was probably not
    a code at all)."""
    found = entries(workspace)
    mine = for_model(found, model, revision)
    # A table row first, then the most specific heading that names the code.
    hits = sorted((e for e in mine if e['code'] == mention.code), key=lambda e: (e['header'] is None, -e['depth']))
    others = models_with(found, mention.code, registry)
    if hits:
        entry = hits[0]
        here = comparable(entry['meaning'], registry)
        same, differs = [], []
        for other, other_hits in others.items():
            if other == model:
                continue
            if any(comparable(h['meaning'], registry) == here for h in other_hits):
                same.append(_ref(registry, other))
            else:
                differs.append(_ref(registry, other))
        definition = registry.models[model]
        revision_ref = next(({'id': r['id'], 'label': r['label']} for r in definition.get('revisions', [])
                             if r['id'] == revision), None)
        return {'kind': 'found', 'code': entry['code'], 'display': entry['display'], 'scheme': entry['scheme'],
                'model': _ref(registry, model), 'revision': revision_ref, 'meaning': entry['meaning'],
                'header': entry['header'], 'unitId': entry['unitId'], 'chunkId': entry['chunkId'],
                'location': entry['location'], 'docId': entry['docId'], 'docName': entry['docName'],
                # From an upload whose models aren't confirmed: it counts for every model.
                'unconfirmed': not entry['confirmed'], 'sameIn': same, 'differsIn': differs}
    candidates = {e['code']: (e['display'], e['scheme']) for e in mine}
    near = identifiers.did_you_mean(mention.code, mention.scheme, candidates)
    if not near and not others and mention.scheme == 'token':
        return None
    revision_ref = next(({'id': r['id'], 'label': r['label']} for r in registry.models[model].get('revisions', [])
                         if r['id'] == revision), None)
    return {'kind': 'not_found', 'code': mention.code, 'display': mention.display, 'scheme': mention.scheme,
            'model': _ref(registry, model), 'revision': revision_ref, 'didYouMean': near,
            'elsewhere': [_ref(registry, other) for other in others if other != model]}


def matrix(workspace: Workspace, registry: Registry, *, q: str = '', family: str = '', differs: bool = False,
           limit: int = 400) -> dict:
    """Every code × every model: each cell holds the meaning the model's
    manual gives the code, or nothing. A row ``differs`` when two models give
    it meanings that disagree (the rule in clarify.py)."""
    found = entries(workspace)
    members = set(registry.families[family]['members']) if family in registry.families else None
    models = [m for m in registry.models.values()
              if not family or (m['id'] in members if members is not None else m.get('family') == family)]
    by_code: dict[str, dict] = {}
    for model in models:
        for entry in for_model(found, model['id']):
            row = by_code.setdefault(entry['code'], {'code': entry['code'], 'display': entry['display'],
                                                     'scheme': entry['scheme'], 'cells': {}})
            row['cells'].setdefault(model['id'], {'meaning': entry['meaning'], 'chunkId': entry['chunkId'],
                                                  'display': entry['display'], 'header': entry['header']})
    query = q.strip().lower()
    rows = []
    for row in by_code.values():
        if query and query not in row['code'].lower() and query not in row['display'].lower() \
                and not any(query in c['meaning'].lower() for c in row['cells'].values()):
            continue
        meanings = {comparable(c['meaning'], registry) for c in row['cells'].values()}
        row['differs'] = len(row['cells']) > 1 and len(meanings) > 1
        if differs and not row['differs']:
            continue
        row['cells'] = {m['id']: row['cells'].get(m['id']) for m in models}
        rows.append(row)
    rows.sort(key=lambda r: (not r['differs'], -sum(1 for c in r['cells'].values() if c), r['code']))
    differing = sum(1 for r in rows if r['differs'])
    return {'models': [{**_ref(registry, m['id']), 'family': m.get('family')} for m in models],
            'rows': rows[:limit], 'counts': {'codes': len(rows), 'differing': differing}}


def suggest(workspace: Workspace, registry: Registry, q: str, model: str | None, limit: int = 8) -> list[dict]:
    """Codes that start with what has been typed, the chosen model's first."""
    typed = identifiers.canonical_token(q) if q else ''
    if not typed:
        return []
    found = entries(workspace)
    pool = for_model(found, model) if model else found
    seen, out = set(), []
    for entry in sorted(pool, key=lambda e: (len(e['code']), e['code'])):
        if entry['code'] in seen:
            continue
        flat = identifiers.canonical_token(entry['display'])
        if not (entry['code'].startswith(typed) or flat.startswith(typed)):
            continue
        seen.add(entry['code'])
        holders = [m for m, hits in models_with(found, entry['code'], registry).items()]
        out.append({'code': entry['code'], 'display': entry['display'], 'scheme': entry['scheme'],
                    'models': holders, 'meaning': entry['meaning'][:160]})
        if len(out) >= limit:
            break
    return out
