"""Turn extracted blocks into the notes' sections.

A section is what a student would call one: a heading and the text under it.
Every retrieval chunk belongs to exactly one section, which is what makes
"expand a small match to its parent section" possible. A heading with a lot
under it is split at paragraph boundaries into parts of at most
``SECTION_MAX_WORDS`` words, so a parent always fits a reasonable context.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from rag_core.web.documents import LIMITS, clean_line, is_heading
from rag_core.web.extraction import Block

SECTION_MAX_WORDS = 220
# A final part smaller than this rejoins the part before it.
SECTION_MIN_TAIL_WORDS = 40
TITLE_LIMIT = 120


@dataclass
class Section:
    id: str
    title: str
    text: str
    location: str
    pages: list[int] | None
    ocr: bool
    heading: str
    part: int = 1
    parts: int = 1

    @property
    def words(self) -> int:
        return len(self.text.split())

    def as_dict(self) -> dict:
        return {'id': self.id, 'title': self.title, 'text': self.text, 'location': self.location,
                'pages': self.pages, 'words': self.words, 'ocr': self.ocr, 'heading': self.heading,
                'part': self.part, 'parts': self.parts}


def _words(text: str) -> int:
    return len(text.split())


def _location(blocks: list[Block], index: int) -> tuple[str, list[int] | None]:
    pages = sorted({b.page for b in blocks if b.page is not None})
    if pages:
        first, last = pages[0], pages[-1]
        return (f'p. {first}' if first == last else f'p. {first}–{last}'), [first, last]
    paras = sorted({b.para for b in blocks if b.para is not None})
    if paras:
        first, last = paras[0], paras[-1]
        return (f'¶ {first}' if first == last else f'¶ {first}–{last}'), None
    return f'part {index}', None


def _split_long(block: Block) -> list[Block]:
    """Break a paragraph longer than a section at sentence boundaries, then at words."""
    pieces, current = [], []
    for sentence in re.split(r'(?<=[.!?;])\s+', block.text):
        tokens = sentence.split()
        while len(tokens) > SECTION_MAX_WORDS:
            if current:
                pieces.append(' '.join(current))
                current = []
            pieces.append(' '.join(tokens[:SECTION_MAX_WORDS]))
            tokens = tokens[SECTION_MAX_WORDS:]
        if current and len(current) + len(tokens) > SECTION_MAX_WORDS:
            pieces.append(' '.join(current))
            current = []
        current.extend(tokens)
    if current:
        pieces.append(' '.join(current))
    return [Block(piece, block.page, block.para, False, block.ocr) for piece in pieces]


def _parts(blocks: list[Block]) -> list[list[Block]]:
    """Pack a heading's paragraphs into parts of at most SECTION_MAX_WORDS."""
    parts: list[list[Block]] = []
    current: list[Block] = []
    size = 0
    for block in blocks:
        for piece in (_split_long(block) if _words(block.text) > SECTION_MAX_WORDS else [block]):
            count = _words(piece.text)
            if current and size + count > SECTION_MAX_WORDS:
                parts.append(current)
                current, size = [], 0
            current.append(piece)
            size += count
    if current:
        parts.append(current)
    if len(parts) > 1:
        tail = sum(_words(b.text) for b in parts[-1])
        before = sum(_words(b.text) for b in parts[-2])
        if tail < SECTION_MIN_TAIL_WORDS and before + tail <= SECTION_MAX_WORDS * 1.25:
            parts[-2].extend(parts.pop())
    return parts


def build_sections(blocks: list[Block], document_title: str) -> tuple[list[Section], bool]:
    """Return (sections, truncated)."""
    groups: list[tuple[str, list[Block]]] = []
    title = document_title
    headings: list[str] = []   # headings seen since the last body text
    body: list[Block] = []

    for block in blocks:
        if not block.text.strip():
            continue
        heading = block.heading if block.heading is not None else is_heading(block.text)
        if heading:
            text = clean_line(block.text.lstrip('#').lstrip('•').strip())
            if not text:
                continue
            if body:
                groups.append((title, body))
                body, headings = [], []
            headings.append(text)
            # A chapter heading directly above a section heading names it too.
            joined = ' · '.join(headings[-2:])
            title = joined if len(joined) <= TITLE_LIMIT else headings[-1][:TITLE_LIMIT]
            continue
        body.append(block)
        headings = []
    if body:
        groups.append((title, body))

    sections: list[Section] = []
    truncated = False
    characters = 0
    for heading_title, group in groups:
        parts = _parts(group)
        for number, part in enumerate(parts, 1):
            if len(sections) >= LIMITS['sections'] or characters >= LIMITS['characters_per_document']:
                truncated = True
                break
            text = '\n\n'.join(b.text.strip() for b in part)
            location, pages = _location(part, len(sections) + 1)
            name = heading_title if len(parts) == 1 else f'{heading_title} (part {number} of {len(parts)})'
            sections.append(Section(f's{len(sections) + 1:03d}', name[:LIMITS['title']], text, location, pages,
                                    any(b.ocr for b in part), heading_title[:LIMITS['title']], number, len(parts)))
            characters += len(text)
        if truncated:
            break
    return sections, truncated
