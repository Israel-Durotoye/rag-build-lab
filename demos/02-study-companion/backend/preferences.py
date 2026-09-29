"""The student's settings, stored per workspace.

Two kinds live here. How explanations are written (level, extra instructions,
the "not found" sentence) changes the prompt. How context is built (fixed
chunk size, matches per question, word budget, expansion threshold) changes
what the model gets to read; only the chunk size needs the notes re-indexed.
"""
from __future__ import annotations

LEVELS = {
    'simple': ('Simple',
               '- Explain as you would to someone meeting the subject for the first time.\n'
               '- Use short sentences and everyday words; define each technical term the first time it appears.\n'
               '- Use one example, taken from the notes.\n'
               '- Stay under about 120 words.'),
    'standard': ('Standard',
                 '- Give the direct answer first, in one or two plain sentences.\n'
                 '- Then explain the idea in a few short steps, using the definitions and examples in the notes.\n'
                 '- Keep exact figures, names and terms as the notes write them.\n'
                 '- Stay under about 150 words unless the question needs more. Do not add a closing summary.'),
    'exam': ('Exam revision',
             '- State the definition first, in the notes\' own wording, with the key term in bold.\n'
             '- List conditions, exceptions and common mistakes as separate bullet points.\n'
             '- End with a one-line takeaway worth memorising.\n'
             '- Stay under about 180 words.'),
}
DEFAULT_NOT_FOUND = ("I couldn't find this in your notes. Try asking it another way, "
                     "or add the notes that cover it.")
DEFAULTS = {'level': 'standard', 'instructions': '', 'notFound': DEFAULT_NOT_FOUND,
            'chunkWords': 50, 'k': 5, 'budgetWords': 600, 'expandBelowWords': 60}
TEXT_LIMITS = {'instructions': 2000, 'notFound': 300}
RANGES = {'chunkWords': (20, 200), 'k': (1, 10), 'budgetWords': (100, 2000), 'expandBelowWords': (10, 300)}
FIELDS = tuple(DEFAULTS)


class PreferencesError(ValueError):
    """A plain, user-facing settings problem."""


def preferences(raw: dict | None) -> dict:
    """Stored settings merged over the defaults; anything invalid is ignored."""
    merged = dict(DEFAULTS)
    raw = raw or {}
    if raw.get('level') in LEVELS:
        merged['level'] = raw['level']
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
    if 'level' in value:
        if value['level'] not in LEVELS:
            raise PreferencesError('Choose one of the explanation levels: ' + ', '.join(LEVELS) + '.')
        clean['level'] = value['level']
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
    """Per-request context options: the stored settings, overridden by any of
    ``k``, ``budgetWords`` and ``expandBelowWords`` in the request."""
    chosen = {field: stored[field] for field in ('k', 'budgetWords', 'expandBelowWords', 'chunkWords')}
    for field in ('k', 'budgetWords', 'expandBelowWords'):
        if field in body:
            low, high = RANGES[field]
            if type(body[field]) is not int or not low <= body[field] <= high:
                raise PreferencesError(f'{field} must be a whole number from {low} to {high}.')
            chosen[field] = body[field]
    return chosen
