"""Split extracted blocks into retrieval chunks.

Chunks are about TARGET characters, never cut mid-paragraph unless a single
paragraph is longer than MAXIMUM, start fresh at headings, carry the latest
heading as their title, and overlap: a short final paragraph is repeated at
the start of the next chunk so an answer that straddles the boundary is
still retrievable. Each chunk cites the pages (or paragraphs) it spans.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .documents import LIMITS, clean_line, is_heading
from .extraction import Block

TARGET = 1000
MAXIMUM = 1400
MINIMUM = 250
OVERLAP_MAX = 250


@dataclass
class Chunk:
    id: str
    title: str
    text: str
    location: str
    pages: list[int] | None
    ocr: bool

    @property
    def chars(self) -> int:
        return len(self.text)

    def as_dict(self) -> dict:
        return {'id': self.id, 'title': self.title, 'text': self.text, 'location': self.location,
                'pages': self.pages, 'chars': self.chars, 'ocr': self.ocr}


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
    """Break an oversized paragraph at sentence boundaries, then at words."""
    pieces, current = [], ''
    for sentence in re.split(r'(?<=[.!?;])\s+', block.text):
        while len(sentence) > MAXIMUM:
            cut = sentence.rfind(' ', 0, TARGET)
            cut = cut if cut > TARGET // 2 else TARGET
            if current:
                pieces.append(current)
                current = ''
            pieces.append(sentence[:cut])
            sentence = sentence[cut:].lstrip()
        if current and len(current) + len(sentence) + 1 > TARGET:
            pieces.append(current)
            current = sentence
        else:
            current = f'{current} {sentence}'.strip()
    if current:
        pieces.append(current)
    return [Block(piece, block.page, block.para, False, block.ocr) for piece in pieces]


def chunk_blocks(blocks: list[Block], document_title: str) -> tuple[list[Chunk], bool]:
    """Return (chunks, truncated)."""
    chunks: list[Chunk] = []
    heading = document_title
    buffer: list[Block] = []
    carried: Block | None = None  # overlap repeated from the previous chunk
    buffer_title = heading
    truncated = False
    total_chars = 0
    sources: list[list[Block]] = []  # each chunk's own blocks, for its citation

    def size() -> int:
        return sum(len(b.text) for b in buffer)

    def has_new_text() -> bool:
        return any(b is not carried and not b.heading for b in buffer)

    def flush(overlap: bool) -> None:
        nonlocal buffer, carried, buffer_title, total_chars, truncated
        if not has_new_text():
            return
        if len(chunks) >= LIMITS['chunks_per_document'] or total_chars >= LIMITS['characters_per_document']:
            truncated = True
            buffer, carried = [], None
            return
        text = '\n\n'.join(b.text.strip() for b in buffer)
        own = [b for b in buffer if b is not carried] or buffer
        location, pages = _location(own, len(chunks) + 1)
        chunks.append(Chunk(f'c{len(chunks) + 1:03d}', buffer_title[:LIMITS['title']], text, location, pages,
                            any(b.ocr for b in buffer)))
        sources.append(own)
        total_chars += len(text)
        last = buffer[-1]
        carried = last if overlap and not last.heading and len(last.text) <= OVERLAP_MAX else None
        buffer = [carried] if carried else []
        buffer_title = heading

    for block in blocks:
        if not block.text.strip():
            continue
        heading_block = block.heading if block.heading is not None else is_heading(block.text)
        if heading_block:
            heading = clean_line(block.text.lstrip('#').lstrip('•').strip())
            new = [b for b in buffer if b is not carried and not b.heading]
            new_chars = sum(len(b.text) for b in new)
            if new_chars >= MINIMUM:
                flush(overlap=False)
            elif new and chunks and not any(b.heading for b in buffer) \
                    and chunks[-1].chars + new_chars <= MAXIMUM + OVERLAP_MAX:
                # A short tail of the previous section rejoins that section's chunk.
                last = chunks[-1]
                last.text += '\n\n' + '\n\n'.join(b.text.strip() for b in new)
                sources[-1] = sources[-1] + new
                last.location, last.pages = _location(sources[-1], len(chunks))
                last.ocr = last.ocr or any(b.ocr for b in new)
                total_chars += new_chars
                buffer, carried = [], None
            if not has_new_text():
                # A section never starts with the previous section's overlap,
                # and a heading with no text under it gives way to the next.
                buffer, carried = [], None
                buffer_title = heading
            elif buffer_title == document_title:
                # Opening text before any heading takes the first heading's name.
                buffer_title = heading
            elif len(buffer_title) + len(heading) <= 90:
                # A short section shares its chunk with the next one.
                buffer_title = f'{buffer_title} · {heading}'
            buffer.append(Block(heading, block.page, block.para, True, block.ocr))
            continue
        for piece in (_split_long(block) if len(block.text) > MAXIMUM else [block]):
            if buffer and size() + len(piece.text) > MAXIMUM and size() >= MINIMUM:
                flush(overlap=True)
            buffer.append(piece)
            if size() >= TARGET:
                flush(overlap=True)
    flush(overlap=False)
    return chunks, truncated
