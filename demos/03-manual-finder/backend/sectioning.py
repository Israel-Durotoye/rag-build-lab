"""A manual's sections and units.

A section is a heading and what is under it. A unit is the smallest passage
Finder indexes, filters and cites:

- a table row (with its table's header line, so a row is never read without
  knowing what its columns are);
- a list, or each item of it when the items name different models;
- a paragraph (split at sentence ends past UNIT_MAX_WORDS);
- a run of small fragments (PDF lines), joined up to SMALL_JOIN_WORDS.

Units are what makes "the exact row for the exact model" possible: a lookup
table of eight boards becomes eight units, each tagged with its own board.
Unit text is the source's own words; only markup is removed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from rag_core.web.documents import clean_line, is_heading, slugify
from rag_core.web.extraction import Block

UNIT_MAX_WORDS = 120
# A passage is also cut at this many characters: one "word" without spaces
# can be any length (the sample's longest passage is about 700).
MAX_UNIT_CHARS = 2000
# A table's header line is kept with each of its rows.
MAX_HEADER_CHARS = 500
SMALL_WORDS = 8
SMALL_JOIN_WORDS = 60
MAX_SECTIONS = 1500
MAX_UNITS = 6000
TITLE_LIMIT = 140

RULE_CELL = re.compile(r':?-{3,}:?')
LIST_ITEM = re.compile(r'^\s*(?:[-*•‣◦▪]|\d{1,3}[.)])\s+')
SENTENCE = re.compile(r'(?<=[.!?;])\s+(?=[A-Z0-9"“(])')


@dataclass
class Unit:
    id: str
    section_id: str
    text: str
    kind: str                      # paragraph | list | item | row | note
    location: str
    header: str | None = None
    pages: list[int] | None = None
    ocr: bool = False

    @property
    def words(self) -> int:
        return len(self.text.split())


@dataclass
class Section:
    id: str
    title: str
    path: list[str]
    location: str
    units: list[Unit] = field(default_factory=list)


def words(text: str) -> int:
    return len(text.split())


def is_rule(line: str) -> bool:
    """A Markdown table's rule line ("| --- | :---: |"). Checked cell by cell:
    one regex over the whole line, with a space run on each side of an
    optional "|", takes time growing with the square of a long space run."""
    text = line.strip()
    if not text or set(text) - set('|:- \t'):
        return False
    return all(RULE_CELL.fullmatch(cell.strip()) for cell in text.strip('|').split('|'))


def is_table(lines: list[str]) -> bool:
    return len(lines) >= 3 and '|' in lines[0] and is_rule(lines[1])


def is_list(lines: list[str]) -> bool:
    return bool(lines) and sum(1 for line in lines if LIST_ITEM.match(line)) >= max(1, len(lines) // 2)


def list_items(lines: list[str]) -> list[str]:
    """A list's items, each with its continuation lines."""
    items: list[list[str]] = []
    for line in lines:
        if LIST_ITEM.match(line) or not items:
            items.append([line.strip()])
        else:
            items[-1].append(line.strip())
    return [' '.join(item) for item in items]


def split_chars(text: str, limit: int = MAX_UNIT_CHARS) -> list[str]:
    """Text too long for one passage even within the word limit, cut at the
    last space before ``limit`` (or at ``limit`` when there is none)."""
    pieces = []
    while len(text) > limit:
        cut = text.rfind(' ', 0, limit)
        cut = cut if cut > limit // 2 else limit
        pieces.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    return [*pieces, text] if text else pieces


def split_long(text: str, limit: int = UNIT_MAX_WORDS) -> list[str]:
    """Break a paragraph longer than ``limit`` words at sentence ends (then
    at words, for a sentence that is itself too long)."""
    if words(text) <= limit:
        return [text]
    pieces, current = [], []
    for sentence in SENTENCE.split(text):
        tokens = sentence.split()
        while len(tokens) > limit:
            if current:
                pieces.append(' '.join(current))
                current = []
            pieces.append(' '.join(tokens[:limit]))
            tokens = tokens[limit:]
        if current and len(current) + len(tokens) > limit:
            pieces.append(' '.join(current))
            current = []
        current.extend(tokens)
    if current:
        pieces.append(' '.join(current))
    return pieces


def block_units(text: str, names_differ) -> list[tuple[str, str, str | None]]:
    """(kind, text, header) units of one block of text. ``names_differ(items)``
    says whether list items name different models, in which case each item
    stands alone so it can carry its own tag."""
    lines = [line for line in text.split('\n') if line.strip()]
    if is_table(lines):
        header = ' | '.join(c.strip() for c in lines[0].strip().strip('|').split('|'))
        rows = []
        for line in lines[2:]:
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if any(cells):
                rows.append(('row', f"{header}\n{' | '.join(cells)}", header))
        return rows
    if is_list(lines):
        items = list_items(lines)
        if len(items) > 1 and names_differ(items):
            return [('item', item, None) for item in items]
        joined = '\n'.join(items)
        if words(joined) <= UNIT_MAX_WORDS:
            return [('list', joined, None)]
        units, current = [], []
        for item in items:
            if current and words(' '.join(current + [item])) > UNIT_MAX_WORDS:
                units.append(('list', '\n'.join(current), None))
                current = []
            current.append(item)
        if current:
            units.append(('list', '\n'.join(current), None))
        return units
    paragraph = clean_line(' '.join(lines))
    kind = 'note' if re.match(r'^(note|warning|caution|important|tip)\b[:.]?', paragraph, re.I) else 'paragraph'
    return [(kind, piece, None) for piece in split_long(paragraph)]


def _location(blocks: list[Block]) -> tuple[str, list[int] | None]:
    pages = sorted({b.page for b in blocks if b.page is not None})
    if pages:
        first, last = pages[0], pages[-1]
        return (f'p. {first}' if first == last else f'p. {first}–{last}'), [first, last]
    paras = sorted({b.para for b in blocks if b.para is not None})
    if paras:
        first, last = paras[0], paras[-1]
        return (f'¶ {first}' if first == last else f'¶ {first}–{last}'), None
    return 'start', None


def build_sections(blocks: list[Block], document_name: str, names_differ=lambda items: False
                   ) -> tuple[list[Section], bool]:
    """Sections and units from extracted blocks. Returns (sections, truncated)."""
    sections: list[Section] = []
    used_ids: set[str] = set()
    truncated = False
    current: Section | None = None
    small: list[Block] = []
    unit_count = 0

    def new_section(title: str, block: Block | None) -> Section:
        base = slugify(title) or 'section'
        section_id, n = base, 2
        while section_id in used_ids:
            section_id, n = f'{base}-{n}', n + 1
        used_ids.add(section_id)
        location, _ = _location([block] if block else [])
        section = Section(section_id, title[:TITLE_LIMIT], [document_name, title[:TITLE_LIMIT]]
                          if title != document_name else [document_name], location)
        sections.append(section)
        return section

    def add_units(source: list[Block]) -> None:
        nonlocal unit_count, truncated
        if not source or current is None:
            return
        text = '\n'.join(b.text for b in source)
        location, pages = _location(source)
        for kind, unit_text, header in block_units(text, names_differ):
            header = header[:MAX_HEADER_CHARS] if header else header
            for piece in split_chars(unit_text):
                if unit_count >= MAX_UNITS:
                    truncated = True
                    return
                unit_count += 1
                unit_id = f'{current.id}-u{len(current.units) + 1:02d}'
                current.units.append(Unit(unit_id, current.id, piece, kind, location, header, pages,
                                          any(b.ocr for b in source)))

    def flush_small() -> None:
        if small:
            add_units(list(small))
            small.clear()

    for block in blocks:
        text = block.text.strip()
        if not text:
            continue
        heading = block.heading if block.heading is not None else is_heading(text)
        if heading:
            flush_small()
            if len(sections) >= MAX_SECTIONS:
                truncated = True
                break
            current = new_section(clean_line(text), block)
            continue
        if current is None:
            current = new_section(document_name, block)
        lines = [line for line in text.split('\n') if line.strip()]
        if words(text) < SMALL_WORDS and not is_table(lines) and not is_list(lines):
            # PDF fragments: join them until they make a passage.
            small.append(block)
            if words(' '.join(b.text for b in small)) >= SMALL_JOIN_WORDS:
                flush_small()
            continue
        flush_small()
        add_units([block])
    flush_small()
    return [s for s in sections if s.units], truncated
