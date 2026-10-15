"""Each workspace's settings: how answers are written and how passages are
found. Stored per workspace; anything invalid falls back to the default."""
from __future__ import annotations

from rag_core.web.retrieval import MAX_RRF_CONSTANT, MODES, RRF_CONSTANT

STYLES = {
    'brief': ('Brief',
              '- Answer in one or two sentences, then stop.\n'
              '- Keep codes, pin names, part numbers and settings exactly as the manual writes them.\n'
              '- Stay under about 60 words.'),
    'standard': ('Standard',
                 '- Give the direct answer first, in one or two plain sentences.\n'
                 '- Then add the conditions, steps or exceptions the passages give, briefly.\n'
                 '- Keep codes, pin names, part numbers and settings exactly as the manual writes them.\n'
                 '- Stay under about 140 words. Do not add a closing summary.'),
    'steps': ('Step by step',
              '- When the passages describe a procedure, give it as numbered steps in the manual\'s own order.\n'
              '- Put any warning before the step it concerns.\n'
              '- Keep codes, pin names, part numbers and settings exactly as the manual writes them.\n'
              '- Stay under about 180 words.'),
}
DEFAULT_NOT_FOUND = "The manual for this model doesn't cover this. Try other words, or check another section."
DEFAULTS = {'style': 'standard', 'instructions': '', 'notFound': DEFAULT_NOT_FOUND,
            'mode': 'hybrid', 'k': 5, 'rrfConstant': RRF_CONSTANT, 'budgetWords': 500}
TEXT_LIMITS = {'instructions': 2000, 'notFound': 300}
RANGES = {'k': (1, 10), 'rrfConstant': (1, MAX_RRF_CONSTANT), 'budgetWords': (100, 2000)}
FIELDS = tuple(DEFAULTS)


class PreferencesError(ValueError):
    """A plain, user-facing settings problem."""


def preferences(raw: dict | None) -> dict:
    """Stored settings merged over the defaults; anything invalid is ignored."""
    merged = dict(DEFAULTS)
    raw = raw or {}
    if raw.get('style') in STYLES:
        merged['style'] = raw['style']
    if raw.get('mode') in MODES:
        merged['mode'] = raw['mode']
    for field, limit in TEXT_LIMITS.items():
        value = raw.get(field)
        if isinstance(value, str) and value.strip():
            merged[field] = value.strip()[:limit]
    for field, (low, high) in RANGES.items():
        value = raw.get(field)
        if type(value) is int and low <= value <= high:
            merged[field] = value
    return merged


def validate(value) -> dict:
    """Validate an update from the interface. Blank text means 'use the default'."""
    if not isinstance(value, dict):
        raise PreferencesError('Send the settings as an object.')
    unknown = sorted(set(value) - set(FIELDS))
    if unknown:
        raise PreferencesError(f'Unknown setting “{unknown[0]}”.')
    clean: dict = {}
    if 'style' in value:
        if value['style'] not in STYLES:
            raise PreferencesError('Choose one of the answer styles: ' + ', '.join(STYLES) + '.')
        clean['style'] = value['style']
    if 'mode' in value:
        if value['mode'] not in MODES:
            raise PreferencesError('Choose one of the search modes: ' + ', '.join(MODES) + '.')
        clean['mode'] = value['mode']
    for field, limit in TEXT_LIMITS.items():
        if field not in value:
            continue
        text = value[field] if value[field] is not None else ''
        if not isinstance(text, str):
            raise PreferencesError(f'{field} must be text.')
        text = text.strip()
        if len(text) > limit:
            raise PreferencesError(f'{field} must stay under {limit} characters.')
        if field == 'notFound' and '\n' in text:
            raise PreferencesError('The “not found” message must be a single sentence or line.')
        clean[field] = text
    for field, (low, high) in RANGES.items():
        if field not in value:
            continue
        number = value[field]
        if type(number) is not int or not low <= number <= high:
            raise PreferencesError(f'{field} must be a whole number from {low} to {high}.')
        clean[field] = number
    return clean


def options(body: dict, stored: dict) -> dict:
    """Per-request search options: the stored settings, overridden by any of
    ``k``, ``rrfConstant`` and ``budgetWords`` in the request."""
    chosen = {field: stored[field] for field in ('k', 'rrfConstant', 'budgetWords')}
    for field in chosen:
        if field in body:
            low, high = RANGES[field]
            if type(body[field]) is not int or not low <= body[field] <= high:
                raise PreferencesError(f'{field} must be a whole number from {low} to {high}.')
            chosen[field] = body[field]
    return chosen
