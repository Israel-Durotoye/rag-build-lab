"""Model names in text: which device models a passage or a question is about.

Manuals for look-alike products name them in ways that differ by a character
or a word: "3B" and "3B+", "Nano 33 BLE" and "Nano 33 BLE Sense", "Rev1" and
"Rev2". A keyword index cannot tell some of these apart (its tokenizer drops
the "+"), so model names are matched here, before anything is indexed, and
every passage records the models it applies to.

Matching rules
- Case does not matter. Spaces, hyphens and dashes inside a name are
  optional and interchangeable, and a separator may also appear where letters
  meet digits: "3B+", "3 B+" and "3-B+" are one name; so are "Rev2" and "Rev 2".
- A name matches only whole: it may not be preceded by a letter or digit, nor
  followed by a letter, a digit or "+". So "3B" never matches inside "3B+",
  "13B" or "3B2".
- Where names overlap, the longest wins: "Nano 33 BLE Sense" is never read
  as "Nano 33 BLE".
- A family name ("Raspberry Pi 3") stands for all of its members.
- A revision label ("v1.2", "Rev2") counts only right after a mention of a
  model that has that revision (within REVISION_REACH characters), or when the
  document covers exactly one model with that label.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

SEPARATOR = r'[\s\-‐-―−_]*'
BEFORE = r'(?<![A-Za-z0-9])'
AFTER = r'(?![A-Za-z0-9+])'
REVISION_REACH = 40
MODEL_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
NAME_LIMIT = 80
MAX_ALIASES = 24
MAX_REVISIONS = 12


class VariantError(ValueError):
    """A plain, user-facing problem with a list of models."""


def _char_class(char: str) -> str:
    if char.isdigit():
        return 'digit'
    if char.isalpha():
        return 'alpha'
    return 'other'


def alias_pattern(alias: str) -> str:
    """A regex fragment for one alias, following the matching rules above."""
    parts: list[str] = []
    previous = None
    for char in alias.strip():
        if char.isspace() or char in '-‐‑‒–—―−_':
            if parts and parts[-1] != SEPARATOR:
                parts.append(SEPARATOR)
            previous = None
            continue
        kind = _char_class(char)
        # Letters meeting digits may be written apart: "Rev 2", "3 B+".
        if previous and kind != previous and {kind, previous} == {'alpha', 'digit'} and parts[-1] != SEPARATOR:
            parts.append(SEPARATOR)
        parts.append(re.escape(char))
        previous = kind
    while parts and parts[-1] == SEPARATOR:
        parts.pop()
    return ''.join(parts)


# ", 2", " and 4", ", or 3+" after a name that ends in a number. A full stop
# may end the list ("2 and 3."); a decimal point may not ("2 and 3.3V").
_CONTINUATION = re.compile(r'\s*(?:,|/|&|\band\b|\bor\b)\s*(?:(?:and|or)\s+)?(\d+[A-Za-z]?\+?)(?![A-Za-z0-9+]|\.\d)')

_REVISION_LABEL = re.compile(r'^(?:v|ver\.?|version|rev\.?|revision|r)\s*(\d+(?:\.\d+)*[a-z]?)$', re.I)


def _revision_spellings(label: str) -> list[str]:
    """The usual ways to write a revision label: v1.2 = rev 1.2 = revision
    1.2 = version 1.2. A bare number is never one of them ("1.2" alone could
    be anything)."""
    match = _REVISION_LABEL.match(label.strip())
    if not match:
        return []
    number = match.group(1)
    return [f'v{number}', f'rev {number}', f'rev. {number}', f'revision {number}', f'version {number}']


def squash(text: str) -> str:
    """A name reduced to its letters, digits and '+', lower case: the key two
    spellings of the same name share."""
    return re.sub(r'[^a-z0-9+]', '', text.lower())


@dataclass(frozen=True)
class Mention:
    alias: str
    kind: str                 # 'model' | 'family' | 'revision'
    models: tuple[str, ...]
    revision: str | None
    start: int
    end: int

    def as_dict(self) -> dict:
        return {'alias': self.alias, 'kind': self.kind, 'models': list(self.models), 'revision': self.revision,
                'start': self.start, 'end': self.end}


@dataclass
class Registry:
    """The models (and families) a library knows, with every name they go by."""
    models: dict[str, dict]
    families: dict[str, dict] = field(default_factory=dict)
    # Names of models outside the library. A passage that names only these is
    # about another product, not shared by every model.
    outside: tuple[str, ...] = ()

    def __post_init__(self):
        targets: dict[str, tuple[str, tuple[str, ...]]] = {}
        for model in self.models.values():
            for alias in {model['name'], model.get('short') or '', *model.get('aliases', [])}:
                if squash(alias):
                    targets.setdefault(alias, ('model', (model['id'],)))
                    if alias.endswith('+'):
                        # "3B+" is also written "3B plus" or "3B-plus".
                        targets.setdefault(alias[:-1].rstrip() + ' plus', ('model', (model['id'],)))
        for family in self.families.values():
            members = tuple(m for m in family.get('members', []) if m in self.models)
            for alias in {family['name'], *family.get('aliases', [])}:
                if squash(alias) and members:
                    targets.setdefault(alias, ('family', members))
        for alias in self.outside:
            if squash(alias):
                targets.setdefault(alias, ('outside', ()))
        self._targets = targets
        self._by_squash = {squash(a): t for a, t in targets.items()}
        ordered = sorted(targets, key=lambda a: (-len(squash(a)), a))
        self._pattern = (re.compile('|'.join(f'(?P<a{i}>{BEFORE}{alias_pattern(a)}{AFTER})'
                                             for i, a in enumerate(ordered)), re.IGNORECASE)
                         if ordered else None)
        self._ordered = ordered
        revisions: dict[str, list[tuple[str, str]]] = {}
        for model in self.models.values():
            for revision in model.get('revisions', []):
                for alias in {revision['label'], *revision.get('aliases', []), *_revision_spellings(revision['label'])}:
                    if squash(alias) and (model['id'], revision['id']) not in revisions.get(alias, []):
                        revisions.setdefault(alias, []).append((model['id'], revision['id']))
        ordered_revisions = sorted(revisions, key=lambda a: (-len(squash(a)), a))
        self._revisions = revisions
        self._revision_order = ordered_revisions
        self._revision_pattern = (re.compile('|'.join(f'(?P<r{i}>{BEFORE}{alias_pattern(a)}{AFTER})'
                                                      for i, a in enumerate(ordered_revisions)), re.IGNORECASE)
                                  if ordered_revisions else None)

    @classmethod
    def from_lists(cls, models: list[dict], families: list[dict] | None = None,
                   outside: list[str] | tuple[str, ...] = ()) -> 'Registry':
        return cls({m['id']: m for m in models}, {f['id']: f for f in families or []}, tuple(outside))

    def merged(self, other: 'Registry') -> 'Registry':
        """This registry plus another's models and families (first definition wins)."""
        return Registry({**other.models, **self.models}, {**other.families, **self.families},
                        tuple(dict.fromkeys((*self.outside, *other.outside))))

    # --------------------------------------------------------------- finding

    def mentions(self, text: str, scope: list[str] | None = None) -> list[Mention]:
        """Every model, family and revision named in ``text``, in order.
        ``scope`` (model IDs) limits which models a bare revision label can
        belong to, e.g. the models a document covers."""
        found: list[Mention] = []
        if self._pattern is not None:
            for match in self._pattern.finditer(text):
                if text[match.start() - 1:match.start()] == '[' and text[match.end():match.end() + 1] == ']':
                    continue  # a literal token such as the config.txt filter "[pi3]", not a mention
                alias = self._ordered[int(match.lastgroup[1:])]
                kind, models = self._targets[alias]
                found.append(Mention(alias, kind, models, None, match.start(), match.end()))
                found.extend(self._enumerated(text, alias, match.end()))
        if self._revision_pattern is not None:
            taken = [(m.start, m.end) for m in found]
            for match in self._revision_pattern.finditer(text):
                if any(start < match.end() and match.start() < end for start, end in taken):
                    continue  # inside a model name, e.g. "Rev2" of a product called "... Rev2"
                alias = self._revision_order[int(match.lastgroup[1:])]
                owners = self._revisions[alias]
                owner = self._revision_owner(found, owners, match.start(), scope)
                if owner is not None:
                    found.append(Mention(alias, 'revision', (owner[0],), owner[1], match.start(), match.end()))
        return sorted(found, key=lambda m: m.start)

    def _enumerated(self, text: str, alias: str, end: int) -> list[Mention]:
        """Names continued by an enumeration: in "Raspberry Pi 1, 2, 3, and
        4" or "Compute Module 3 and 3+", each later number stands for the
        first name with that number."""
        stem = re.match(r'^(.*?)(\d+[A-Za-z]?\+?)$', alias)
        if not stem or not stem.group(1).strip():
            return []
        prefix, found, position = stem.group(1), [], end
        while True:
            more = _CONTINUATION.match(text, position)
            if not more:
                return found
            candidate = prefix + more.group(1)
            target = self._by_squash.get(squash(candidate))
            if target is None:
                return found
            kind, models = target
            found.append(Mention(candidate, kind, models, None, more.start(1), more.end(1)))
            position = more.end()

    def _revision_owner(self, found: list[Mention], owners: list[tuple[str, str]], start: int,
                        scope: list[str] | None) -> tuple[str, str] | None:
        before = list(reversed([m for m in found if m.end <= start and start - m.end <= REVISION_REACH]))
        after = [m for m in found if m.start >= start and m.start - start <= REVISION_REACH]
        # The nearest mention decides: right after a model that has this
        # revision ("2B v1.2"), or right before one ("revision 1.2 of the 2B").
        # Next to another model the label describes that model ("3B+
        # (BCM2837B0)"), even with an owner further away ("the 3B and 3B+
        # (BCM2837B0)").
        nearest = before[0] if before else after[0] if after else None
        if nearest is not None:
            if nearest.kind != 'outside':
                for model_id, revision_id in owners:
                    if model_id in nearest.models:
                        return model_id, revision_id
            return None
        # Standing alone, it belongs to the only model in scope that has it.
        candidates = [o for o in owners if scope is None or o[0] in scope]
        return candidates[0] if len(candidates) == 1 else None

    def resolve(self, text: str) -> dict:
        """What a question says about models: {'models': [...], 'revisions':
        {model: rev}, 'family': id | None, 'mentions': [...]}"""
        mentions = self.mentions(text)
        models: list[str] = []
        family = None
        revisions: dict[str, str] = {}
        for mention in mentions:
            if mention.kind == 'model':
                models.extend(m for m in mention.models if m not in models)
            elif mention.kind == 'family':
                family = next((f['id'] for f in self.families.values()
                               if tuple(m for m in f.get('members', []) if m in self.models) == mention.models), None)
                models.extend(m for m in mention.models if m not in models)
            elif mention.kind == 'revision' and mention.revision:
                revisions[mention.models[0]] = mention.revision
                if mention.models[0] not in models:
                    models.append(mention.models[0])
        return {'models': models, 'revisions': revisions, 'family': family,
                'named': [m for m in mentions if m.kind in {'model', 'revision'}],
                'mentions': [m.as_dict() for m in mentions]}

    def strip(self, text: str) -> str:
        """``text`` without any model, family or revision name (see the
        disagreement rule in clarify.py)."""
        spans = [(m.start, m.end) for m in self.mentions(text)]
        out, last = [], 0
        for start, end in spans:
            out.append(text[last:start])
            last = end
        out.append(text[last:])
        return ' '.join(out)


# ------------------------------------------------------------------- tagging

def _qualified(named: list[Mention]) -> set[tuple[int, str]]:
    """(mention index, model) pairs whose model is narrowed by a revision
    next to it: in "2B v1.2 and 3B", the 2B mention is qualified, the 3B
    mention is bare (every revision)."""
    qualified: set[tuple[int, str]] = set()
    for index, mention in enumerate(named):
        if mention.kind != 'revision':
            continue
        model_id = mention.models[0]
        before = [i for i in range(index) if named[i].kind != 'revision' and model_id in named[i].models
                  and 0 <= mention.start - named[i].end <= REVISION_REACH]
        after = [i for i in range(index + 1, len(named)) if named[i].kind != 'revision'
                 and model_id in named[i].models and 0 <= named[i].start - mention.end <= REVISION_REACH]
        if before:
            qualified.add((before[-1], model_id))
        elif after:
            qualified.add((after[0], model_id))
    return qualified


def tag(text: str, heading_texts: list[str], registry: Registry, scope: dict[str, list[str] | None]) -> dict:
    """The models and revisions one passage applies to.

    ``scope`` maps each model the document covers to the revisions it covers
    (None: all of them). The passage's own mentions decide first; failing
    those, the deepest heading above it that names a model; failing that it is
    shared by everything in scope. A passage that names only models outside
    the library is marked ``outside``.

    Returns {'models': [ids] | None, 'revisions': {model: [revision ids]},
    'outside': bool, 'source': 'text' | 'heading' | 'document'}."""
    models_in_scope = list(scope)
    for source, candidate in [('text', text), *(('heading', h) for h in reversed(heading_texts))]:
        mentions = registry.mentions(candidate, models_in_scope)
        named = [m for m in mentions if m.kind in {'model', 'family', 'revision'}]
        if not named:
            if any(m.kind == 'outside' for m in mentions):
                return {'models': [], 'revisions': {}, 'outside': True, 'source': source}
            continue
        models: list[str] = []
        revisions: dict[str, set[str]] = {}
        bare: set[str] = set()
        qualified = _qualified(named)
        for index, mention in enumerate(named):
            for model_id in mention.models:
                if model_id not in scope:
                    continue
                if model_id not in models:
                    models.append(model_id)
                if mention.kind == 'revision' and mention.revision:
                    revisions.setdefault(model_id, set()).add(mention.revision)
                elif (index, model_id) not in qualified:
                    bare.add(model_id)
        if not models:
            # Named only models this document does not cover.
            return {'models': [], 'revisions': {}, 'outside': True, 'source': source}
        result_revisions: dict[str, list[str]] = {}
        for model_id in models:
            if model_id in revisions and model_id not in bare:
                result_revisions[model_id] = sorted(revisions[model_id])
            elif scope.get(model_id):
                result_revisions[model_id] = list(scope[model_id])
        return {'models': models, 'revisions': result_revisions, 'outside': False, 'source': source}
    return {'models': None, 'revisions': {m: list(r) for m, r in scope.items() if r}, 'outside': False,
            'source': 'document'}


def applies(unit: dict, document_models: list[str], model: str, revision: str | None = None) -> bool:
    """Whether a passage applies to ``model`` (and ``revision`` when given).
    A shared passage (models None) applies to every model of its document; a
    manual that lists no models at all applies to every model."""
    models = unit.get('models')
    if models is None:
        if document_models and model not in document_models:
            return False
    elif model not in models:
        return False
    if revision is not None:
        allowed = (unit.get('revisions') or {}).get(model)
        if allowed is not None and revision not in allowed:
            return False
    return True


# ------------------------------------------------------------- suggestions

_WORD = re.compile(r'[A-Za-z0-9+]+(?:[-.][A-Za-z0-9+]+)*')
_STOPWORDS = {'the', 'a', 'an', 'this', 'that', 'these', 'your', 'our', 'its', 'each', 'every', 'on', 'in', 'for',
              'with', 'and', 'or', 'to', 'of', 'by', 'see', 'use', 'note', 'warning', 'table', 'figure', 'page',
              'section', 'chapter', 'step', 'pin', 'pins', 'port', 'version', 'revision', 'rev'}


# Numbers with units ("5V", "1x", "2.5A") and unit words after a number.
_MEASURE = re.compile(r'^\d+(?:[.-]\d+)?-?(?:x|v|vdc|a|ma|mah|w|mw|hz|khz|mhz|ghz|b|kb|mb|gb|bit|bits|mm|cm|s|ms|%)$', re.I)
_UNIT_WORD = re.compile(r'^(?:x|v|vdc|vac|a|ma|mah|w|mw|kw|hz|khz|mhz|ghz|b|kb|mb|gb|tb|bit|bits|mm|cm|m|s|ms|us|'
                        r'degrees?|pins?|channels?|times|hours?|minutes?|seconds?|ohms?|kohms?)$', re.I)


def _has_digit(word: str) -> bool:
    return any(c.isdigit() for c in word)


def _capitalised(word: str) -> bool:
    return word[:1].isupper() and word.lower() not in _STOPWORDS


def suggest(texts: list[str], limit: int = 12, exclude: set[str] | frozenset[str] = frozenset()) -> list[dict]:
    """Names that look like product models, most frequent first, to help
    whoever uploads a manual list the models it covers.

    A name is anchored on a word with a digit ("R4", "3", "MK4S", "3B+") and
    joined to at least one capitalised word around it: "UNO R4 Minima",
    "Raspberry Pi 3 Model B+". A lone code ("D13", "I2C") is not a name, and
    nothing in ``exclude`` (the manual's own codes, canonical form) is."""
    counts: Counter[str] = Counter()
    for text in texts:
        # A full stop ends a clause, but not inside a number ("USB 2.0"); so
        # does a menu-path separator ("File > Examples > 01.Basics").
        for clause in re.split(r'[;:!?\n()\[\],|/"“”>›»→]|\.(?!\d)', text):
            words = _WORD.findall(clause)
            for i, word in enumerate(words):
                if not _has_digit(word) or len(word) > 12 or _MEASURE.match(word):
                    continue
                if re.match(r'^\d+(?:[.-]\d+)?$', word) and i + 1 < len(words) and _UNIT_WORD.match(words[i + 1]):
                    continue  # "5 V", "48 MHz": a measurement, not a model
                left = i
                while left > 0 and i - left < 2 and _capitalised(words[left - 1]) and not _has_digit(words[left - 1]):
                    left -= 1
                right = i
                while (right + 1 < len(words) and right - i < 2 and _capitalised(words[right + 1])
                       and not _has_digit(words[right + 1])):
                    right += 1
                if left == i and right == i:
                    continue
                name = ' '.join(words[left:right + 1])
                if re.sub(r'[\s\-_]', '', name).upper() in exclude or re.sub(r'[\s\-_]', '', word).upper() in exclude:
                    continue
                counts[name] += 1
    return [{'name': name, 'count': count} for name, count in counts.most_common(limit) if count >= 2]


# ------------------------------------------------------------- validation

def _text(value, label: str, limit: int = NAME_LIMIT) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VariantError(f'{label} must be text.')
    text = ' '.join(value.split())
    if len(text) > limit:
        raise VariantError(f'{label} must stay under {limit} characters.')
    return text


def _slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')[:64] or 'model'


def _name_key(name: str) -> str:
    return re.sub(r'[\s\-_]+', '', name).lower()


def adopt_known(models, known: dict[str, dict]):
    """New rows (no ID) of an upload's tagging step that name a model the
    library already has, by its name, short name or another name (case and
    spacing ignored), take that model's ID, names and revisions. The upload
    then joins the model instead of adding a look-alike beside it.
    Everything else is left as sent, for validate_models to check."""
    if not isinstance(models, list):
        return models
    index: dict[str, dict] = {}
    for model in known.values():
        for name in (model['name'], model.get('short') or '', *model.get('aliases', [])):
            if name.strip():
                index.setdefault(_name_key(name), model)
    adopted = []
    for item in models:
        names = []
        if isinstance(item, dict) and not item.get('id'):
            aliases = item.get('aliases') if isinstance(item.get('aliases'), list) else []
            names = [n for n in (item.get('name'), item.get('short'), *aliases) if isinstance(n, str) and n.strip()]
        match = next((index[_name_key(n)] for n in names if _name_key(n) in index), None)
        if match is None:
            adopted.append(item)
            continue
        others = [n for n in dict.fromkeys([*match.get('aliases', []), *names])
                  if _name_key(n) != _name_key(match['name'])]
        adopted.append({**item, 'id': match['id'], 'name': match['name'],
                        'short': match.get('short') or match['name'],
                        'family': item.get('family') or match.get('family'), 'aliases': others[:MAX_ALIASES],
                        'revisions': item.get('revisions') or match.get('revisions', [])})
    return adopted


def validate_models(models, families=None) -> tuple[list[dict], list[dict]]:
    """Validate a list of model definitions (and families) from an upload's
    tagging step, filling in IDs and short names where they are missing."""
    if not isinstance(models, list) or len(models) > 60:
        raise VariantError('Send up to 60 models.')
    clean, seen = [], set()
    for index, item in enumerate(models, 1):
        if not isinstance(item, dict):
            raise VariantError(f'Model {index} must be an object.')
        name = _text(item.get('name'), f'Model {index} name')
        model_id = item.get('id') or _slug(name)
        if not isinstance(model_id, str) or not MODEL_ID.match(model_id):
            raise VariantError(f'Model “{name}” needs an ID of lowercase letters, numbers and hyphens.')
        if model_id in seen:
            raise VariantError(f'Two models share the ID “{model_id}”.')
        seen.add(model_id)
        aliases = item.get('aliases', [])
        if not isinstance(aliases, list) or len(aliases) > MAX_ALIASES:
            raise VariantError(f'Model “{name}” may have up to {MAX_ALIASES} other names.')
        aliases = list(dict.fromkeys(_text(a, f'A name of “{name}”') for a in aliases))
        revisions_in = item.get('revisions', [])
        if not isinstance(revisions_in, list) or len(revisions_in) > MAX_REVISIONS:
            raise VariantError(f'Model “{name}” may have up to {MAX_REVISIONS} revisions.')
        revisions, revision_ids = [], set()
        for revision in revisions_in:
            if not isinstance(revision, dict):
                raise VariantError(f'Each revision of “{name}” must be an object.')
            label = _text(revision.get('label'), f'A revision label of “{name}”', 40)
            revision_id = revision.get('id') or _slug(label)
            if not isinstance(revision_id, str) or not MODEL_ID.match(revision_id) or revision_id in revision_ids:
                raise VariantError(f'Revision “{label}” of “{name}” needs a unique ID.')
            revision_ids.add(revision_id)
            revision_aliases = revision.get('aliases', [])
            if not isinstance(revision_aliases, list) or len(revision_aliases) > MAX_ALIASES:
                raise VariantError(f'Revision “{label}” may have up to {MAX_ALIASES} other names.')
            revisions.append({'id': revision_id, 'label': label,
                              'aliases': list(dict.fromkeys(_text(a, f'A name of revision “{label}”', 40)
                                                            for a in revision_aliases))})
        short = item.get('short') or name
        family = item.get('family')
        if family is not None and (not isinstance(family, str) or not MODEL_ID.match(family)):
            raise VariantError(f'The family of “{name}” must be an ID.')
        clean.append({'id': model_id, 'name': name, 'short': _text(short, f'Short name of “{name}”', 24),
                      'family': family, 'aliases': aliases, 'revisions': revisions})
    clean_families = []
    if families is not None:
        if not isinstance(families, list) or len(families) > 20:
            raise VariantError('Send up to 20 families.')
        for item in families:
            if not isinstance(item, dict):
                raise VariantError('Each family must be an object.')
            name = _text(item.get('name'), 'Family name')
            family_id = item.get('id') or _slug(name)
            if not isinstance(family_id, str) or not MODEL_ID.match(family_id):
                raise VariantError(f'Family “{name}” needs an ID.')
            members = [m for m in item.get('members', []) if isinstance(m, str) and m in seen]
            aliases = item.get('aliases', [])
            if not isinstance(aliases, list) or len(aliases) > MAX_ALIASES:
                raise VariantError(f'Family “{name}” may have up to {MAX_ALIASES} other names.')
            clean_families.append({'id': family_id, 'name': name, 'members': members,
                                   'aliases': list(dict.fromkeys(_text(a, f'A name of “{name}”') for a in aliases))})
    return clean, clean_families
