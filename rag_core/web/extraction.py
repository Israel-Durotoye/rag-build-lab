"""Read an uploaded PDF, Word or text file into ordered text blocks.

PDF: PyMuPDF reads each page's text layer as paragraph blocks. Pages without
one (scans) are rendered and read with OCR; pages that have text but are
mostly images are OCR'd too, keeping only lines the text layer lacks.
Word: python-docx reads paragraphs (with heading styles) and table rows in
order; embedded pictures are OCR'd.

``extract`` is a generator: it yields progress events and finally
``{'type': 'extracted', 'result': Extracted}``.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Iterator

from .documents import LIMITS, clean_line, is_heading
from .ocr import OcrEngine

# A page "has a text layer" above this many non-space characters.
TEXT_LAYER_THRESHOLD = 40
# Pages whose images cover at least this share of the page are OCR'd as well
# (a figure or table screenshot commonly takes a tenth of a page).
IMAGE_COVERAGE = 0.10
# Individual images smaller than this share of the page (logos, icons) are ignored.
MIN_IMAGE_SHARE = 0.02
# At most this many OCR passes per file keeps uploads bounded.
OCR_LIMIT = 120
OCR_DPI = 200
OCR_MAX_SIDE_PX = 2500
OCR_MARKER = 'Text in images (OCR):'
PAGE_NUMBER = re.compile(r'^\s*(page\s+)?(\d{1,4}|[ivxlc]{1,6})\s*$', re.I)
# Symbol-font bullets (Wingdings etc.) land in the Unicode private use area.
PRIVATE_USE = re.compile(r'[-]')
SUPPORTED = {'.pdf': 'pdf', '.docx': 'word', '.txt': 'text', '.md': 'text'}
# Reading stops at the per-document character limit (and a PDF at this many
# pages), marking the result truncated: a small PDF can repeat one large
# content stream on every page.
MAX_PDF_PAGES = 2000
# A Word file is a zip that python-docx unpacks whole into memory, so its
# directory is checked first.
DOCX_MAX_EXPANDED = 100 * 1024 * 1024
DOCX_MAX_XML = 25 * 1024 * 1024
DOCX_MAX_PARTS = 5000


class ExtractionError(ValueError):
    """A plain, user-facing extraction failure."""


@dataclass
class Block:
    text: str
    page: int | None = None      # PDF page number
    para: int | None = None      # paragraph number (Word and text files)
    heading: bool | None = None  # None: decide from the text
    ocr: bool = False


@dataclass
class Extracted:
    name: str
    format: str
    bytes: int
    blocks: list[Block] = field(default_factory=list)
    pages: list[dict] = field(default_factory=list)  # per-page stats (PDF only)
    page_count: int = 0
    ocr_pages: int = 0
    image_regions: int = 0
    ocr_failed: bool = False
    truncated: bool = False


def file_format(filename: str) -> str:
    suffix = PurePath(filename).suffix.lower()
    if suffix == '.doc':
        raise ExtractionError("Legacy .doc files aren't supported. Save it as .docx or PDF first.")
    if suffix not in SUPPORTED:
        raise ExtractionError('Add a PDF (.pdf), Word (.docx) or text (.txt, .md) file.')
    return SUPPORTED[suffix]


def document_name(filename: str) -> str:
    stem = PurePath(filename.replace('\\', '/')).stem
    stem = re.sub(r'[\x00-\x1f\x7f]', '', stem).strip()
    return stem[:LIMITS['title']] or 'Document'


def _compact(text: str) -> str:
    return ''.join(text.split())


def _normalize(text: str) -> str:
    return re.sub(r'[^0-9a-z]+', '', text.lower())


def _progress(stage: str, done: int | None = None, total: int | None = None) -> dict:
    event = {'type': 'progress', 'stage': stage}
    if total:
        event.update(done=done, total=total)
    return event


def _image_coverage(page) -> float:
    import pymupdf

    area = page.rect.width * page.rect.height
    if area <= 0:
        return 0.0
    covered = 0.0
    for info in page.get_image_info():
        box = pymupdf.Rect(info['bbox']) & page.rect
        if box.is_empty:
            continue
        share = box.width * box.height / area
        if share >= MIN_IMAGE_SHARE:
            covered += share
    return min(covered, 1.0)


def _render(page) -> bytes:
    import pymupdf

    zoom = min(OCR_DPI / 72, OCR_MAX_SIDE_PX / max(page.rect.width, page.rect.height, 1))
    return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes('png')


def _worth_reading(blob: bytes) -> bool:
    """Skip icons and decorations: OCR only images big enough to hold text."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(blob)) as image:
            width, height = image.size
    except Exception:
        return False
    return min(width, height) >= 32 and width * height >= 20_000


def _new_lines(lines: list[str], known_text: str) -> list[str]:
    known = _normalize(known_text)
    fresh = []
    for line in lines:
        key = _normalize(line)
        if len(key) >= 3 and key not in known:
            fresh.append(line)
            known += key
    return fresh


def _group_lines(lines: list[str], page: int | None = None, para: int | None = None) -> list[Block]:
    """OCR returns lines; group them into paragraph-sized blocks."""
    blocks, buffer = [], []
    for line in lines:
        if is_heading(line):
            if buffer:
                blocks.append(Block('\n'.join(buffer), page, para, False, True))
                buffer = []
            blocks.append(Block(line, page, para, True, True))
            continue
        buffer.append(line)
        if sum(len(item) for item in buffer) >= 350:
            blocks.append(Block('\n'.join(buffer), page, para, False, True))
            buffer = []
    if buffer:
        blocks.append(Block('\n'.join(buffer), page, para, False, True))
    return blocks


def _pdf(data: bytes, ocr: OcrEngine | None, result: Extracted) -> Iterator[dict]:
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype='pdf')
    except Exception:
        raise ExtractionError('This PDF could not be opened. Try re-exporting it.') from None
    try:
        if doc.needs_pass:
            raise ExtractionError('This PDF is password-protected. Remove the password and try again.')
        total = doc.page_count
        result.page_count = total
        per_page: dict[int, list[Block]] = {}
        methods: dict[int, str] = {}
        jobs: list[tuple[int, str]] = []
        characters, last = 0, 0
        for number, page in enumerate(doc, 1):
            if number > MAX_PDF_PAGES or characters >= LIMITS['characters_per_document']:
                result.truncated = True
                break
            last = number
            yield _progress('text', number, total)
            blocks = [Block(b[4].strip(), number) for b in page.get_text('blocks', sort=True)
                      if b[6] == 0 and b[4].strip()]
            # Running page numbers sit alone at the top or bottom of a page.
            while blocks and PAGE_NUMBER.match(blocks[-1].text):
                blocks.pop()
            while blocks and PAGE_NUMBER.match(blocks[0].text):
                blocks.pop(0)
            characters += sum(len(b.text) for b in blocks)
            if len(_compact(''.join(b.text for b in blocks))) < TEXT_LAYER_THRESHOLD:
                jobs.append((number, 'scan'))
                methods[number] = 'empty'
            else:
                per_page[number] = blocks
                methods[number] = 'text'
                if _image_coverage(page) >= IMAGE_COVERAGE:
                    jobs.append((number, 'images'))

        targets = jobs[:OCR_LIMIT]
        result.truncated = result.truncated or len(jobs) > OCR_LIMIT
        if targets and ocr is None:
            result.ocr_failed = True
            targets = []
        for done, (number, kind) in enumerate(targets, 1):
            yield _progress('ocr', done, len(targets))
            try:
                lines = ocr.read(_render(doc[number - 1]))
            except Exception:
                result.ocr_failed = True
                continue
            if kind == 'scan':
                if len(_compact(''.join(lines))) >= 20:
                    per_page[number] = _group_lines(lines, page=number)
                    methods[number] = 'ocr'
                    result.ocr_pages += 1
            else:
                fresh = _new_lines(lines, '\n'.join(b.text for b in per_page[number]))
                if fresh:
                    per_page[number].append(Block(f'{OCR_MARKER}\n' + '\n'.join(fresh), number, None, False, True))
                    methods[number] = 'text+ocr'
                    result.image_regions += 1
    finally:
        doc.close()

    if not per_page:
        raise ExtractionError(
            'This PDF has no text layer and OCR could not run on this server.' if result.ocr_failed
            else 'No readable text was found in this PDF.')
    for number in range(1, last + 1):
        blocks = per_page.get(number, [])
        result.blocks.extend(blocks)
        result.pages.append({'page': number, 'chars': sum(len(b.text) for b in blocks), 'method': methods[number]})


def _check_docx(data: bytes) -> None:
    """Refuse a Word file whose parts would unpack to more than the limits."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            parts = archive.infolist()
    except (zipfile.BadZipFile, ValueError):
        raise ExtractionError('This Word file could not be opened. Save it again as .docx and retry.') from None
    xml = sum(p.file_size for p in parts if p.filename.endswith(('.xml', '.rels')))
    if (len(parts) > DOCX_MAX_PARTS or sum(p.file_size for p in parts) > DOCX_MAX_EXPANDED
            or xml > DOCX_MAX_XML):
        raise ExtractionError('This Word file unpacks to more than can be read here. Save a smaller copy, '
                              'or export it as PDF, and try again.')


def _docx(data: bytes, ocr: OcrEngine | None, result: Extracted) -> Iterator[dict]:
    import docx
    from docx.table import Table

    _check_docx(data)
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception:
        raise ExtractionError('This Word file could not be opened. Save it again as .docx and retry.') from None

    para, characters = 0, 0
    for block in document.iter_inner_content():
        if characters >= LIMITS['characters_per_document']:
            result.truncated = True
            break
        if isinstance(block, Table):
            for row in block.rows:
                # Merged cells repeat their text in every spanned cell.
                cells = dict.fromkeys(cell.text.strip() for cell in row.cells if cell.text.strip())
                if cells:
                    para += 1
                    result.blocks.append(Block(' | '.join(cells), para=para, heading=False))
                    characters += len(result.blocks[-1].text)
            continue
        text = block.text.strip()
        if not text:
            continue
        para += 1
        style = block.style.name if block.style is not None else ''
        styled = style.startswith(('Heading', 'Title')) and len(text) <= LIMITS['title']
        result.blocks.append(Block(text, para=para, heading=True if styled else None))
        characters += len(text)

    images = [part.blob for part in document.part.related_parts.values()
              if getattr(part, 'content_type', '') in {'image/png', 'image/jpeg', 'image/bmp', 'image/tiff'}
              and _worth_reading(part.blob)][:OCR_LIMIT]
    if images and ocr is None:
        result.ocr_failed = True
    elif images:
        known = '\n'.join(b.text for b in result.blocks)
        found: list[str] = []
        for done, blob in enumerate(images, 1):
            yield _progress('ocr', done, len(images))
            try:
                fresh = _new_lines(ocr.read(blob), known + '\n'.join(found))
            except Exception:
                result.ocr_failed = True
                continue
            if fresh:
                found.extend(fresh)
                result.image_regions += 1
        if found:
            para += 1
            result.blocks.append(Block(OCR_MARKER.rstrip(':'), para=para, heading=True, ocr=True))
            result.blocks.extend(_group_lines(found, para=para))
    if not result.blocks:
        raise ExtractionError('No readable text was found in this Word file.')


def _text(data: bytes, result: Extracted) -> Iterator[dict]:
    raw = data.decode('utf-8-sig', errors='replace').replace('\r\n', '\n').replace('\r', '\n')
    if len(raw) > LIMITS['characters_per_document']:
        raw = raw[:LIMITS['characters_per_document']]
        result.truncated = True
    yield _progress('text', 1, 1)
    for para, paragraph in enumerate((p.strip() for p in re.split(r'\n\s*\n', raw) if p.strip()), 1):
        lines = paragraph.split('\n')
        # A markdown heading or heading-shaped first line starts its own block.
        if len(lines) > 1 and is_heading(lines[0]):
            result.blocks.append(Block(lines[0].lstrip('#').strip(), para=para, heading=True))
            paragraph = '\n'.join(lines[1:]).strip()
        elif paragraph.startswith('#'):
            result.blocks.append(Block(paragraph.lstrip('#').strip(), para=para, heading=True))
            continue
        if paragraph:
            result.blocks.append(Block(paragraph, para=para))
    if not result.blocks:
        raise ExtractionError('No readable text was found in this file.')


def extract(data: bytes, filename: str, ocr: OcrEngine | None) -> Iterator[dict]:
    """Yield progress events, then ``{'type': 'extracted', 'result': Extracted}``."""
    fmt = file_format(filename)
    if len(data) > LIMITS['file_bytes']:
        raise ExtractionError('This file is over 40 MB. Export a smaller version and try again.')
    if not data:
        raise ExtractionError('This file is empty.')
    result = Extracted(name=document_name(filename), format=fmt, bytes=len(data))
    yield _progress('reading')
    if fmt == 'pdf':
        yield from _pdf(data, ocr, result)
    elif fmt == 'word':
        yield from _docx(data, ocr, result)
    else:
        yield from _text(data, result)
    for block in result.blocks:
        block.text = PRIVATE_USE.sub('•', block.text.replace('\x00', ''))
        if block.heading:
            block.text = clean_line(block.text)
    yield {'type': 'extracted', 'result': result}
