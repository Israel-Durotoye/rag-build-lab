"""Build the sample library (corpus.json) from the real source files.

    python library/build_corpus.py           # from demos/03-manual-finder

Reads library/sources/ (fetched by fetch_sources.py at pinned commits) and
library/models.json, and writes ../corpus.json: one rag_core document per
manual, where each rag_core "section" is a unit (a paragraph, list, table row,
note or short code block) tagged with the models it applies to.

What it does to the text, and nothing more:
- removes markup (AsciiDoc and Markdown syntax, link targets, anchors, HTML
  tags), keeping the words as written;
- leaves out sections listed under "skip" below (certifications, legal
  notices, translations, pages about other products) and code longer than
  CODE_MAX_LINES lines;
- leaves out passages that name only products outside the library, and rows
  of a model table whose model cell names no product in the library.
Tags come from the same rules uploads use (backend/variants.py), plus the
overrides in models.json, each with its reason. Every unit is checked against
its source file before anything is written.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
sys.path.insert(0, str(DEMO))
sys.path.insert(0, str(DEMO.parents[1]))

from rag_core.web.documents import slugify  # noqa: E402

from backend.ingest import tag_units  # noqa: E402
from backend.sectioning import block_units  # noqa: E402
from backend.variants import Registry  # noqa: E402

SOURCES = HERE / 'sources'
CODE_MAX_LINES = 12
RETRIEVED = '2026-10-15'
LICENCE = 'CC BY-SA 4.0'
LICENCE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
RPI = ('raspberrypi-documentation', 'raspberrypi/documentation', 'ddea98e98dafe9419feb4fd82710c2fbdef7dc44')
DOCS = ('arduino-docs-content', 'arduino/docs-content', 'fcf130898e2ff105e96e0795ba561077c16efb44')
HELP = ('arduino-help-center-content', 'arduino/help-center-content', '2303fc899609b273d0748687a1798072b3e104a9')
RPI_MODELS = ['rpi-2b', 'rpi-3b', 'rpi-3b-plus']
UNO_MODELS = ['uno-r3', 'uno-r4-minima', 'uno-r4-wifi']
DATASHEET_SKIP = ['Certifications', 'Declaration of Conformity', 'Conflict Minerals', 'FCC', 'SRRC',
                  'Company Information', 'Reference Documentation', 'Change Log', 'Revision History',
                  'Mounting Holes', 'Block Diagram', 'Application Examples', 'Related Products',
                  'Getting Started - Arduino Cloud', 'Online Resources']
RPI_PATH = 'documentation/asciidoc/computers/'
HTML_ELEMENTS = ('a|abbr|article|aside|b|blockquote|br|caption|center|code|col|colgroup|dd|details|div|dl|dt|em|'
                 'figcaption|figure|font|footer|h[1-6]|header|hr|i|iframe|img|kbd|li|nav|ol|p|pre|section|small|span|'
                 'strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|tr|u|ul|video')

MANUALS = [
    {'id': 'rpi-hardware', 'title': 'Raspberry Pi hardware', 'source': RPI, 'publisher': 'Raspberry Pi Ltd',
     'url': 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html', 'models': RPI_MODELS,
     'files': [RPI_PATH + f'raspberry-pi/{name}.adoc' for name in
               ('boot-msd', 'bootmodes', 'boot-gpio', 'boot-net', 'power-supplies', 'frequency-management',
                'revision-codes')],
     'skip': ['Devices with an EEPROM bootloader', 'Use DVFS', 'Measure temperatures', 'Add heatsinks',
              'Fan cases', 'Old-style revision codes', 'Check Raspberry Pi model and CPU across distributions',
              'Network boot flow', 'Debugging network boot mode', 'Power over Ethernet (PoE) connector']},
    {'id': 'rpi-configuration', 'title': 'Raspberry Pi configuration: LED behaviour',
     'source': RPI, 'publisher': 'Raspberry Pi Ltd',
     'url': 'https://www.raspberrypi.com/documentation/computers/configuration.html', 'models': RPI_MODELS,
     'files': [RPI_PATH + 'configuration/led_blink_warnings.adoc'],
     'skip': ['Change LED behaviour on Raspberry Pi Zero', 'Configure Raspberry Pi 500 LEDs']},
    {'id': 'rpi-config-txt', 'title': 'The config.txt file: conditional filters', 'source': RPI,
     'publisher': 'Raspberry Pi Ltd', 'url': 'https://www.raspberrypi.com/documentation/computers/config_txt.html',
     'models': RPI_MODELS, 'files': [RPI_PATH + 'config_txt/conditional.adoc'],
     'keep': ['Conditional filters', 'The `[all]` filter', 'Model filters', 'The `[none]` filter']},
    {'id': 'uno-r3-datasheet', 'title': 'Arduino UNO R3 datasheet', 'source': DOCS, 'publisher': 'Arduino',
     'url': 'https://docs.arduino.cc/hardware/uno-rev3/', 'models': ['uno-r3'],
     'files': ['content/hardware/uno/boards/uno-rev3/datasheet/datasheet.md'], 'skip': DATASHEET_SKIP},
    {'id': 'uno-r4-minima-datasheet', 'title': 'Arduino UNO R4 Minima datasheet', 'source': DOCS,
     'publisher': 'Arduino', 'url': 'https://docs.arduino.cc/hardware/uno-r4-minima/', 'models': ['uno-r4-minima'],
     'files': ['content/hardware/uno/boards/uno-r4-minima/datasheet/datasheet.md'], 'skip': DATASHEET_SKIP},
    {'id': 'uno-r4-wifi-datasheet', 'title': 'Arduino UNO R4 WiFi datasheet', 'source': DOCS, 'publisher': 'Arduino',
     'url': 'https://docs.arduino.cc/hardware/uno-r4-wifi/', 'models': ['uno-r4-wifi'],
     'files': ['content/hardware/uno/boards/uno-r4-wifi/datasheet/datasheet.md'], 'skip': DATASHEET_SKIP},
    {'id': 'uno-r4-minima-manual', 'title': 'Arduino UNO R4 Minima user manual', 'source': DOCS,
     'publisher': 'Arduino', 'url': 'https://docs.arduino.cc/tutorials/uno-r4-minima/cheat-sheet/',
     'models': ['uno-r4-minima'], 'files': ['content/hardware/uno/boards/uno-r4-minima/tutorials/cheat-sheet/cheat-sheet.md'],
     'skip': ['Datasheet']},
    {'id': 'uno-r4-wifi-manual', 'title': 'Arduino UNO R4 WiFi user manual', 'source': DOCS, 'publisher': 'Arduino',
     'url': 'https://docs.arduino.cc/tutorials/uno-r4-wifi/cheat-sheet/', 'models': ['uno-r4-wifi'],
     'files': ['content/hardware/uno/boards/uno-r4-wifi/tutorials/cheat-sheet/cheat-sheet.md'], 'skip': ['Datasheet']},
    {'id': 'arduino-help-center', 'title': 'Arduino Help Center: selected articles', 'source': HELP,
     'publisher': 'Arduino', 'url': 'https://support.arduino.cc/hc/en-us', 'models': UNO_MODELS,
     'files': ['content/' + path for path in (
         'Hardware Support/Generic/An-overview-of-different-UNO-boards.md',
         'Hardware Support/UNO/Whats-the-difference-between-UNO-R3-and-UNO-R4-boards.md',
         'Hardware Support/Generic/If-Arduino-UNO-Rev3-or-earlier-or-Mega-is-not-recognized-by-the-computer.md',
         'Software Support/Upload/If-your-board-is-not-detected-by-Arduino-IDE.md',
         'Software Support/Upload/dfu-util-errors-when-uploading-exit-status-74.md',
         'Software Support/Upload/Failed-uploading-uploading-error-exit-status-1.md',
         'Hardware Support/UNO/Touch-reset-fails-for-UNO-R4-WiFi-on-Windows-Arduino-CLI-0-33-0-or-earlier.md',
         'Software Support/IDE Settings/COM-port-number-changes-when-connecting-board-on-different-ports-or-in-bootloader-mode.md',
         'Hardware Support/Generic/Reset-your-board.md',
         'Hardware Support/Generic/My-board-PWR-Led-does-not-turn-on.md',
         'Hardware Support/Generic/What-power-supply-can-I-use-with-my-Arduino-board.md')]},
]


@dataclass
class Piece:
    kind: str           # heading | paragraph | list | table | note | code
    text: str
    line: int
    level: int = 0      # heading level, 1 = page title
    rows: list[tuple[int, list[str]]] | None = None   # table: (line, cells); first is the header


# ------------------------------------------------------------------ inline markup

def inline_asciidoc(text: str) -> str:
    text = re.sub(r'\b(?:xref|link):[^\[\s]*\[([^\]]*)\]', r'\1', text)
    text = re.sub(r'https?://[^\s\[]+\[([^\]]*)\]', r'\1', text)
    text = re.sub(r'<<[^,>]+,\s*([^>]+)>>', r'\1', text)
    text = re.sub(r'<<([^>]+)>>', lambda m: m.group(1).replace('-', ' '), text)
    text = re.sub(r'\[\[[^\]]*\]\]', '', text)
    text = re.sub(r'`\+?([^`]*?)\+?`', r'\1', text)
    text = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'\1', text)
    text = re.sub(r'(?<![\w_])_([^_\n]+)_(?![\w_])', r'\1', text)
    text = text.replace('{nbsp}', ' ').replace('{plus}', '+').replace('&#8203;', '')
    return ' '.join(text.split())


def inline_markdown(text: str) -> str:
    text = re.sub(r'\s*\{#[\w-]+\}\s*$', '', text)
    text = re.sub(r'<a [^>]*>\s*</a>', '', text)
    text = re.sub(r'<br\s*/?>', ' ', text)
    text = re.sub(r'</?(?:sup|sub|b|i|u|em|strong|span|code)\b[^>]*>', '', text)
    # Any other HTML element (tables, lists, rules) keeps only its text. Only
    # real element names count, so "#include <Wire.h>" stays as written.
    text = re.sub(rf'</?(?:{HTML_ELEMENTS})\b[^>]*>', ' ', text)
    # A backslash at the end of a line is a Markdown hard line break.
    text = re.sub(r'\\(?=\s|$)', ' ', text)
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'`([^`]*)`', r'\1', text)
    text = re.sub(r'(\*\*\*|___)(.+?)\1', r'\2', text)
    text = re.sub(r'(\*\*|__)(.+?)\1', r'\2', text)
    text = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'\1', text)
    text = re.sub(r'(?<![\w_])_([^_\n]+)_(?![\w_])', r'\1', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return ' '.join(text.split())


# ------------------------------------------------------------------ AsciiDoc

def parse_asciidoc(source: str) -> list[Piece]:
    lines = source.split('\n')
    pieces: list[Piece] = []
    i = 0
    paragraph: list[str] = []
    start = 0

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            text = inline_asciidoc(' '.join(paragraph))
            match = re.match(r'^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s*(.*)$', text)
            if text:
                pieces.append(Piece('note' if match else 'paragraph', text, start + 1))
            paragraph = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith('//') or re.match(r'^(ifdef|ifndef|endif|include|image)::', stripped):
            flush()
            i += 1
            continue
        heading = re.match(r'^(={2,6})\s+(.+)$', line)
        if heading:
            flush()
            pieces.append(Piece('heading', inline_asciidoc(heading.group(2)), i + 1, len(heading.group(1)) - 1))
            i += 1
            continue
        if not stripped or stripped in {'****', '====', '____', '--'}:
            flush()  # blank lines and the delimiters of sidebar, example and quote blocks
            i += 1
            continue
        if re.match(r'^\[\[[^\]]*\]\]$', stripped) or re.match(r'^\.[A-Za-z]', stripped):
            flush()  # anchors and block titles
            i += 1
            continue
        admonition = re.match(r'^\[(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$', stripped)
        if admonition and i + 1 < len(lines) and lines[i + 1].strip() == '====':
            flush()
            end = next(j for j in range(i + 2, len(lines)) if lines[j].strip() == '====')
            body = [l.strip() for l in lines[i + 2:end]]
            paragraphs = [inline_asciidoc(' '.join(group)) for group in _groups(body)]
            for k, text in enumerate(paragraphs):
                if text:
                    label = f'{admonition.group(1)}: ' if k == 0 else ''
                    pieces.append(Piece('note', label + text, i + 3))
            i = end + 1
            continue
        if stripped.startswith('[') and stripped.endswith(']') and i + 1 < len(lines) \
                and lines[i + 1].strip() in {'----', '....', '|==='}:
            flush()  # block attributes for the block below
            i += 1
            continue
        if stripped.startswith('[') and stripped.endswith(']') and not paragraph:
            i += 1  # other block attributes ([cols=...], [source,...])
            continue
        if stripped in {'----', '....'}:
            flush()
            end = next(j for j in range(i + 1, len(lines)) if lines[j].strip() == stripped)
            body = lines[i + 1:end]
            if 0 < len(body) <= CODE_MAX_LINES:
                pieces.append(Piece('code', '\n'.join(l.rstrip() for l in body), i + 2))
            i = end + 1
            continue
        if stripped == '|===':
            flush()
            end = next(j for j in range(i + 1, len(lines)) if lines[j].strip() == '|===')
            pieces.append(_asciidoc_table(lines, i + 1, end))
            i = end + 1
            continue
        if re.match(r'^(\*{1,3}|\.{1,3}|-)\s+\S', stripped):
            flush()
            items, j = [], i
            while j < len(lines) and lines[j].strip():
                item = re.match(r'^(\*{1,3}|\.{1,3}|-)\s+(.*)$', lines[j].strip())
                if item:
                    marker = '-' if item.group(1)[0] in '*-' else '1.'
                    indent = '  ' * (len(item.group(1)) - 1)
                    items.append(f'{indent}{marker} {inline_asciidoc(item.group(2))}')
                elif items and lines[j].strip() != '+':
                    items[-1] += ' ' + inline_asciidoc(lines[j].strip())
                j += 1
            pieces.append(Piece('list', '\n'.join(items), i + 1))
            i = j
            continue
        if not paragraph:
            start = i
        paragraph.append(stripped)
        i += 1
    flush()
    return pieces


def _groups(lines: list[str]) -> list[list[str]]:
    groups, current = [], []
    for line in lines:
        if line:
            current.append(line)
        elif current:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def _asciidoc_table(lines: list[str], start: int, end: int) -> Piece:
    """An AsciiDoc table: the first line of cells is the header; each later
    blank-line-separated group of cells is a row."""
    rows: list[tuple[int, list[str]]] = []
    current: list[str] = []
    current_line = start + 1
    header: list[str] | None = None
    for index in range(start, end):
        line = lines[index].strip()
        if not line:
            if current:
                rows.append((current_line, current))
                current = []
            continue
        if not line.startswith('|') and current:
            current[-1] += ' ' + inline_asciidoc(line)
            continue
        cells = [inline_asciidoc(re.sub(r'^\d*\+?[<^>]?\.?[<^>]?[a-z]?', '', c.strip()) if re.match(r'^\d+\+', c.strip()) else c)
                 for c in line.split('|')[1:]]
        if not current:
            current_line = index + 1
        current.extend(c for c in cells)
        if header is None and len(current) > 1:
            header = current
            rows.append((current_line, current))
            current = []
    if current:
        rows.append((current_line, current))
    width = len(rows[0][1]) if rows else 0
    fixed: list[tuple[int, list[str]]] = []
    for line, cells in rows:
        # A row written one cell per line arrives as one group; regroup by width.
        for k in range(0, len(cells), width or 1):
            fixed.append((line, [c.strip() for c in cells[k:k + width]]))
    return Piece('table', '', start + 1, rows=fixed)


# ------------------------------------------------------------------ Markdown

def strip_comments(source: str) -> str:
    """HTML comments are never shown to a reader. They are blanked out line
    for line, so every other line keeps its number."""
    return re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), source, flags=re.S)


def parse_markdown(source: str) -> tuple[str | None, list[Piece]]:
    lines = strip_comments(source).split('\n')
    title = None
    i = 0
    if lines and lines[0].strip() == '---':
        end = next(j for j in range(1, len(lines)) if lines[j].strip() == '---')
        for line in lines[1:end]:
            match = re.match(r"^title:\s*['\"]?(.*?)['\"]?\s*$", line)
            if match:
                title = match.group(1)
        i = end + 1
    pieces: list[Piece] = []
    paragraph: list[str] = []
    start = 0

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            text = inline_markdown(' '.join(paragraph))
            if text:
                kind = 'note' if re.match(r'^(note|warning|caution|important|tip)\b', text, re.I) else 'paragraph'
                pieces.append(Piece(kind, text, start + 1))
            paragraph = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if re.match(r'^#\s+中文', stripped):
            break  # the translation that follows repeats the English text
        heading = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', stripped)
        if heading:
            flush()
            pieces.append(Piece('heading', inline_markdown(heading.group(2)), i + 1, len(heading.group(1))))
            i += 1
            continue
        if not stripped or stripped in {'---', '***', '___'} or re.match(rf'^(?:</?(?:{HTML_ELEMENTS})\b[^>]*>\s*)+$', stripped):
            flush()
            i += 1
            continue
        if stripped.startswith('```'):
            flush()
            end = next((j for j in range(i + 1, len(lines)) if lines[j].strip().startswith('```')), len(lines))
            body = lines[i + 1:end]
            if 0 < len(body) <= CODE_MAX_LINES:
                pieces.append(Piece('code', '\n'.join(l.rstrip() for l in body), i + 2))
            i = end + 1
            continue
        if stripped.startswith('|') and i + 1 < len(lines) and re.match(r'^\s*\|?\s*:?-{2,}', lines[i + 1]):
            flush()
            rows: list[tuple[int, list[str]]] = []
            j = i
            while j < len(lines) and lines[j].strip().startswith('|'):
                if j != i + 1:
                    rows.append((j + 1, [inline_markdown(c) for c in lines[j].strip().strip('|').split('|')]))
                j += 1
            pieces.append(Piece('table', '', i + 1, rows=rows))
            i = j
            continue
        if re.match(r'^\s*(?:[-*+]|\d{1,3}[.)])\s+\S', line):
            flush()
            items, j = [], i
            while j < len(lines) and (re.match(r'^\s*(?:[-*+]|\d{1,3}[.)])\s+\S', lines[j])
                                      or (lines[j].startswith(('  ', '\t')) and lines[j].strip() and items)
                                      # A lazy continuation line: text straight after an item.
                                      or (lines[j].strip() and items and lines[j - 1].strip()
                                          and not re.match(r'^(#{1,6}\s|\||```|<|---)', lines[j].strip()))
                                      or (not lines[j].strip() and j + 1 < len(lines)
                                          and re.match(r'^\s+(?:[-*+]|\d{1,3}[.)])\s+\S', lines[j + 1]))):
                item = re.match(r'^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$', lines[j])
                if item:
                    marker = '-' if item.group(2) else f'{item.group(3)}.'
                    indent = '  ' * (len(item.group(1).expandtabs(4)) // 3)
                    items.append([f'{indent}{marker} ', item.group(4)])
                elif lines[j].strip() and items:
                    items[-1][1] += ' ' + lines[j].strip()
                j += 1
            # Markup is removed per item, so a link split over two lines survives.
            pieces.append(Piece('list', '\n'.join(head + inline_markdown(body) for head, body in items), i + 1))
            i = j
            continue
        if stripped.startswith('>'):
            flush()
            text, j = [], i
            while j < len(lines) and lines[j].strip().startswith('>'):
                text.append(lines[j].strip().lstrip('>').strip())
                j += 1
            content = inline_markdown(' '.join(text))
            if content:
                pieces.append(Piece('note', content, i + 1))
            i = j
            continue
        if not paragraph:
            start = i
        paragraph.append(stripped)
        i += 1
    flush()
    return title, pieces


# ------------------------------------------------------------------ assembling

def pipe_table(rows: list[tuple[int, list[str]]]) -> list[tuple[int, str, str]]:
    """(line, unit text, header) for each row of a parsed table. A row whose
    first cell is empty continues the row above (a spanned cell), so it joins
    that row's unit as another line."""
    if not rows:
        return []
    header = ' | '.join(rows[0][1])
    out: list[list] = []
    for line, cells in rows[1:]:
        if not any(c.strip() for c in cells):
            continue
        if out and not cells[0].strip():
            out[-1][1] += '\n' + ' | '.join(cells)
            continue
        out.append([line, f"{header}\n{' | '.join(cells)}", header])
    return [tuple(row) for row in out]


def model_column(header: str) -> int | None:
    heads = [h.strip().lower() for h in header.split('|')]
    return next((i for i, h in enumerate(heads)
                 if re.search(r'\b(models?|products?|boards?)\b', h) and len(h.split()) <= 3), None)


def assemble(manual: dict, registry: Registry, overrides: list[dict], report: dict) -> dict:
    folder, repo, commit = manual['source']
    sections: list[dict] = []
    units: list[dict] = []
    used: set[str] = set()
    stack: list[tuple[int, str]] = []
    current: dict | None = None
    skip_level: int | None = None

    def keep_heading(title: str, level: int) -> bool:
        if manual.get('keep') is not None and level <= 2:
            return title in manual['keep']
        return not any(title.startswith(prefix) for prefix in manual.get('skip', []))

    for path in manual['files']:
        text = (SOURCES / folder / path).read_text()
        filename = path.rsplit('/', 1)[-1]
        if path.endswith('.adoc'):
            pieces = parse_asciidoc(text)
            page_title = None
        else:
            page_title, pieces = parse_markdown(text)
        base = 0
        if page_title and not path.endswith('datasheet.md'):
            # A Help Center article or user manual: its title heads its sections.
            pieces = [Piece('heading', inline_markdown(page_title), 1, 1), *pieces]
            base = 1
        stack = []
        skip_level = None
        current = None
        for piece in pieces:
            if piece.kind == 'heading':
                if piece.text.strip().upper() == 'CONTENTS':
                    continue  # a table-of-contents marker: what follows belongs to the sections below it
                level = piece.level + (base if piece.level > 1 or not base else 0)
                if skip_level is not None and level > skip_level:
                    continue
                skip_level = None
                if not keep_heading(piece.text, level):
                    skip_level = level
                    current = None
                    continue
                stack = [(l, t) for l, t in stack if l < level] + [(level, piece.text)]
                section_id, n = slugify(piece.text) or 'section', 2
                candidate = section_id
                while candidate in used:
                    candidate, n = f'{section_id}-{n}', n + 1
                used.add(candidate)
                current = {'id': candidate, 'title': piece.text, 'path': [manual['title'], *(t for _, t in stack)],
                           'location': f'{filename}:{piece.line}', 'unitIds': []}
                sections.append(current)
                continue
            if skip_level is not None or current is None:
                continue
            for line, kind, unit_text, header in _units(piece):
                unit_id = f"{current['id']}-u{len(current['unitIds']) + 1:02d}"
                current['unitIds'].append(unit_id)
                units.append({'id': unit_id, 'sectionId': current['id'], 'text': unit_text,
                              'location': f'{filename}:{line}', 'kind': kind, 'header': header, 'pages': None,
                              'ocr': False, 'models': None, 'revisions': {}, 'codes': [], '_file': path})
    model_defs = [m for m in registry.models.values() if m['id'] in manual['models']]
    families = [{**f, 'members': [m for m in f['members'] if m in manual['models']]}
                for f in registry.families.values() if any(m in manual['models'] for m in f['members'])]
    record = {'id': manual['id'], 'name': manual['title'], 'sections': sections, 'units': units,
              'modelDefs': model_defs, 'families': families, 'outside': list(registry.outside)}
    tag_units(record)
    by_section = {s['id']: s for s in sections}
    kept, dropped_outside, dropped_rows, dropped_override = [], 0, 0, 0
    for unit in record['units']:
        apply_overrides(unit, by_section[unit['sectionId']], manual['id'], overrides)
        if unit['models'] == []:
            if unit.get('tag') == 'override':
                dropped_override += 1
            else:
                dropped_outside += 1
            continue
        if unit['kind'] == 'row' and unit['header'] is not None:
            column = model_column(unit['header'])
            if column is not None:
                cells = unit['text'].split('\n', 1)[1].split(' | ')
                named = registry.mentions(cells[column] if column < len(cells) else '', manual['models'])
                if not any(m.kind in {'model', 'family'} and set(m.models) & set(manual['models']) for m in named):
                    dropped_rows += 1
                    continue
        kept.append(unit)
    kept_ids = {u['id'] for u in kept}
    record['sections'] = [{**s, 'unitIds': [u for u in s['unitIds'] if u in kept_ids]} for s in sections]
    record['sections'] = [s for s in record['sections'] if s['unitIds']]
    report[manual['id']] = {'units': len(kept), 'droppedOutside': dropped_outside, 'droppedRows': dropped_rows,
                          'droppedOverride': dropped_override}
    return {
        'id': manual['id'],
        'title': manual['title'],
        'version': commit[:7],
        'metadata': {
            'publisher': manual['publisher'], 'url': manual['url'],
            'source': f'https://github.com/{repo}/tree/{commit}',
            'files': [f'https://github.com/{repo}/blob/{commit}/{p}'.replace(' ', '%20') for p in manual['files']],
            'licence': LICENCE, 'licenceUrl': LICENCE_URL, 'retrieved': RETRIEVED,
            'models': list(manual['models']), 'device': list(manual['models']),
        },
        'sections': [_rag_section(u, record) for u in kept],
    }


def apply_overrides(unit: dict, section: dict, document_id: str, overrides: list[dict]) -> None:
    """Corrections from models.json, in order. An override names passages
    ("units": a list of unit IDs), a section ("section") or every section under
    a heading ("heading"). replace "shared" corrects only passages that
    inherited every model of the document; replace "all" corrects every
    passage it covers. "models": null makes a passage shared by every model of
    its manual; an empty list leaves it out. Only an override that names a
    passage can keep one the rules left out (one that names only other
    products), so a section-wide correction never revives those."""
    for override in overrides:
        if override['document'] != document_id:
            continue
        named = unit['id'] in override.get('units', [])
        if 'units' in override:
            covered = named
        elif 'section' in override:
            covered = section['id'] == override['section']
        else:
            covered = override['heading'] in section['path'][1:]
        if not covered or (unit['models'] == [] and not named):
            continue
        if override.get('replace', 'shared') == 'shared' and unit.get('tag') != 'document':
            continue
        override['_used'] = True
        unit['models'] = None if override['models'] is None else list(override['models'])
        unit['revisions'] = dict(override.get('revisions', {}))
        unit['tag'] = 'override'
        unit['tagReason'] = override['reason']


def _units(piece: Piece) -> list[tuple[int, str, str, str | None]]:
    if piece.kind == 'table':
        return [(line, 'row', text, header) for line, text, header in pipe_table(piece.rows or [])]
    if piece.kind == 'code':
        return [(piece.line, 'code', piece.text, None)]
    if piece.kind == 'note':
        return [(piece.line, 'note', text, None) for _, text, _ in block_units(piece.text, lambda items: False)]
    return [(piece.line, kind, text, header) for kind, text, header in block_units(piece.text, _names_differ)]


_REGISTRY: Registry | None = None


def _names_differ(items: list[str]) -> bool:
    """Whether list items name different models (then each item is a unit)."""
    if _REGISTRY is None:
        return False
    named = [frozenset(m for mention in _REGISTRY.mentions(item) for m in mention.models) for item in items]
    return len({n for n in named if n}) > 1


def _rag_section(unit: dict, record: dict) -> dict:
    section = next(s for s in record['sections'] if s['id'] == unit['sectionId'])
    metadata = {'parent': unit['sectionId'], 'path': section['path'], 'kind': unit['kind'], 'tag': unit['tag']}
    if unit['models'] is not None:
        metadata['device'] = unit['models']
    if unit['revisions']:
        metadata['revisions'] = unit['revisions']
    if unit['header']:
        metadata['header'] = unit['header']
    if unit.get('tagReason'):
        metadata['tagReason'] = unit['tagReason']
    return {'id': unit['id'], 'title': section['title'], 'text': unit['text'], 'location': unit['location'],
            'metadata': metadata}


# ------------------------------------------------------------------ checking

def _plain(text: str) -> str:
    return re.sub(r'[^0-9a-z]+', ' ', text.lower()).strip()


def verify(corpus: list[dict]) -> list[str]:
    """Problems found: any unit whose words (cell by cell, line by line) are
    not in the stripped text of its source files."""
    problems = []
    stripped: dict[str, str] = {}
    for manual, document in zip(MANUALS, corpus):
        folder = manual['source'][0]
        text = ' '.join(_plain(inline_asciidoc((SOURCES / folder / name).read_text()) if name.endswith('.adoc')
                               else inline_markdown(strip_comments((SOURCES / folder / name).read_text())))
                        for name in manual['files'])
        stripped[manual['id']] = f' {text} '
        for unit in document['sections']:
            for part in re.split(r'\n| \| ', unit['text']):
                plain = _plain(re.sub(r'^(?:\s*(?:-|\d+\.)\s+|(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s*)', '', part))
                if plain and f' {plain} ' not in stripped[manual['id']]:
                    problems.append(f"{document['id']}/{unit['id']}: {part[:80]!r}")
    return problems


def main() -> int:
    global _REGISTRY
    spec = json.loads((HERE / 'models.json').read_text())
    registry = Registry.from_lists(spec['models'], spec['families'], spec['outside'])
    _REGISTRY = registry
    overrides = list(spec.get('overrides', []))
    report: dict = {}
    corpus = [assemble(manual, registry, overrides, report) for manual in MANUALS]
    unused = [o for o in overrides if not o.get('_used')]
    for override in unused:
        print('OVERRIDE MATCHED NOTHING', {k: v for k, v in override.items() if k != 'reason'})
    if unused:
        print(f'{len(unused)} override(s) matched no passage; corpus.json not written.')
        return 1
    problems = verify(corpus)
    for line in problems:
        print('NOT VERBATIM', line)
    if problems:
        print(f'{len(problems)} unit(s) failed the source check; corpus.json not written.')
        return 1
    (DEMO / 'corpus.json').write_text(json.dumps(corpus, indent=1, ensure_ascii=False) + '\n')
    total = sum(r['units'] for r in report.values())
    for doc_id, counts in report.items():
        print(f"{doc_id:28} {counts['units']:4} units  (left out: {counts['droppedOutside']} about other products, "
              f"{counts['droppedRows']} other-model rows, {counts['droppedOverride']} by a reviewed correction)")
    print(f'{total} units in {len(corpus)} manuals written to corpus.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
