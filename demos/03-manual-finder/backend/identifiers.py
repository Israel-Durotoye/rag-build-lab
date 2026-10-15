"""Exact identifiers: the codes, pins, ports and patterns that mean one
precise thing in one model's manual, and possibly something else in another's.

A manual's tables are its lookup tables. Every table row becomes a code entry
under each identifier in it, so "P102" finds the row that says what P102 is on
this board. A question's identifiers are read the same way and matched by
their canonical form, so "gpio-22", "GPIO 22" and "GPIO22" are one code.

Schemes (canonical form, then how it is shown):
- flash    "4 long, 4 short", "four long flashes followed by four short"
           → FLASH:L4S4, shown "4 long · 4 short"
- gpio     "GPIO 22", "gpio22"                → GPIO22
- hex      "0x2763"                            → 0x2763 (upper-case digits)
- exit     "exit status 74"                    → EXIT STATUS 74
- filter   "[pi3+]" (config section filters)  → [PI3+]
- token    letters and digits together: P102, D13, J1, E17, a020d3 → upper case
Numbers with units (5V, 2.5A, 1GB, 60°C) and model names are never codes.
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass

NUMBER_WORDS = {'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
                'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12}
_COUNT = r'(\d{1,2}|' + '|'.join(NUMBER_WORDS) + r')'
# Every repeat below is bounded ("\s{1,4}", not "\s+"): with an unbounded
# run on each side of an optional part, a long run of spaces would take
# time growing with its square, and a regex holds the interpreter while it
# runs. Real text never puts more than a few spaces between these words.
FLASH = re.compile(_COUNT + r'\s{1,4}long(?:\s{1,4}(?:flash|flashe|blink)s?)?\s{0,4}'
                   r'(?:,|·|and|then|followed\s{1,4}by|\+|/|-)?\s{0,4}(?:and\s{1,4})?'
                   + _COUNT + r'\s{1,4}short(?:\s{1,4}(?:flash|flashe|blink)s?)?', re.I)
GPIO = re.compile(r'(?<![A-Za-z0-9])gpio\s{0,4}[-_]?\s{0,4}(\d{1,3})(?![A-Za-z0-9])', re.I)
HEX = re.compile(r'(?<![A-Za-z0-9])0x([0-9a-f]{1,8})(?![A-Za-z0-9])', re.I)
EXIT = re.compile(r'(?<![A-Za-z0-9])exit\s{1,4}status\s{1,4}(\d{1,4})(?![A-Za-z0-9])', re.I)
FILTER = re.compile(r'\[([a-z][a-z0-9+_-]{1,19})\]', re.I)
# Letters and digits in one token ("P102", "a020d3"), or a short letter
# prefix joined to its number by a hyphen ("e-17", "P-102"). A token is at
# most 16 characters (is_token_code), so the run is bounded too: an
# unbounded "[A-Za-z0-9]*\d[A-Za-z0-9]*" retries every split of a long run.
TOKEN = re.compile(r'(?<![A-Za-z0-9+.\-])([A-Za-z]{1,3}-\d{1,5}[A-Za-z]{0,3}|(?=[A-Za-z]{0,15}\d)[A-Za-z0-9]{1,16})'
                   r'(?![A-Za-z0-9+]|\.\d)')
# The same prefix and number written apart ("E 17", "P 102"): read as one
# code only when the library has that code.
SPLIT = re.compile(r'(?<![A-Za-z0-9+.\-])([A-Za-z]{1,3})\s(\d{1,5})(?![A-Za-z0-9+]|\.\d)')
UNITS = re.compile(r'^\d+(?:\.\d+)?(?:v|vdc|vac|a|ma|mah|w|mw|kw|hz|khz|mhz|ghz|b|kb|mb|gb|tb|kbit|mbit|bit|bits|'
                   r'c|f|k|s|ms|us|ns|mm|cm|m|in|x|p|pcs|nd|st|rd|th|d|h)$', re.I)
CODE_HEADERS = ('code', 'pin', 'port', 'gpio', 'ref', 'designator', 'error', 'filter', 'signal', 'id', 'sku',
                'part', 'flash', 'led', 'status', 'name', 'revision', 'label')
SCHEME_ORDER = ('flash', 'exit', 'gpio', 'hex', 'filter', 'token')


@dataclass(frozen=True)
class Code:
    code: str
    display: str
    scheme: str
    start: int = 0
    end: int = 0
    raw: str = ''


def _count(value: str) -> int:
    value = value.lower()
    return NUMBER_WORDS[value] if value in NUMBER_WORDS else int(value)


def canonical_token(text: str) -> str:
    return re.sub(r'[\s\-_]', '', text).upper()


def is_token_code(text: str) -> bool:
    """Letters and digits together, not a measurement or a size (12x8)."""
    squashed = re.sub(r'[\s\-_]', '', text)
    return (bool(re.search(r'\d', squashed)) and bool(re.search(r'[A-Za-z]', squashed))
            and not UNITS.match(squashed) and not re.match(r'^\d+x\d+$', squashed, re.I)
            and 2 <= len(squashed) <= 16)


def flash_display(code: str) -> str:
    match = re.match(r'FLASH:L(\d+)S(\d+)$', code)
    return f'{match.group(1)} long · {match.group(2)} short' if match else code


def find(text: str, *, skip: list[tuple[int, int]] = (), tokens: bool = True,
         known: set[str] | frozenset[str] = frozenset()) -> list[Code]:
    """Every identifier in ``text``. Spans in ``skip`` (model names) are
    ignored; ``tokens`` False keeps only the unmistakable schemes. A prefix
    and number written apart ("E 17") count when their joined form is in
    ``known``."""
    found: list[Code] = []
    # The spans taken so far, sorted and apart, so each check is a bisect
    # rather than a pass over every code already found.
    starts: list[int] = []
    ends: list[int] = []

    def free(start: int, end: int) -> bool:
        i = bisect.bisect_left(starts, end)
        return i == 0 or ends[i - 1] <= start

    def take(start: int, end: int) -> None:
        i = bisect.bisect_left(starts, start)
        starts.insert(i, start)
        ends.insert(i, end)

    for start, end in sorted(skip):
        if starts and start < ends[-1]:
            ends[-1] = max(ends[-1], end)  # overlapping names merge into one span
        else:
            starts.append(start)
            ends.append(end)

    def add(code: str, display: str, scheme: str, match: re.Match, group: int = 0) -> None:
        start, end = match.span(group)
        if free(start, end):
            found.append(Code(code, display, scheme, start, end, match.group(group)))
            take(start, end)

    for match in FLASH.finditer(text):
        long, short = _count(match.group(1)), _count(match.group(2))
        add(f'FLASH:L{long}S{short}', f'{long} long · {short} short', 'flash', match)
    for match in EXIT.finditer(text):
        add(f'EXIT STATUS {match.group(1)}', f'exit status {match.group(1)}', 'exit', match)
    for match in GPIO.finditer(text):
        add(f'GPIO{int(match.group(1))}', f'GPIO {int(match.group(1))}', 'gpio', match)
    for match in HEX.finditer(text):
        add('0x' + match.group(1).upper(), '0x' + match.group(1).upper(), 'hex', match)
    for match in FILTER.finditer(text):
        add(f'[{match.group(1).upper()}]', f'[{match.group(1).lower()}]', 'filter', match)
    if tokens:
        for match in SPLIT.finditer(text):
            joined = canonical_token(match.group(1) + match.group(2))
            if joined in known:
                add(joined, match.group(0), 'token', match)
        for match in TOKEN.finditer(text):
            raw = match.group(1)
            if is_token_code(raw):
                add(canonical_token(raw), raw, 'token', match, 1)
    return sorted(found, key=lambda c: c.start)


# ------------------------------------------------------------ code tables

def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def row_codes(row: str, header: str | None, skip_names: list[str] = (), context: list[str] = ()) -> list[Code]:
    """The identifiers a table row is about: unmistakable codes anywhere in
    it, letter-and-digit tokens in its first cell or under a code-like
    column, a GPIO number under a "GPIO" column (or under a "Bank" or "Pin"
    column in a section about GPIOs, ``context`` being its headings), and a
    flash pattern from "long" and "short" columns."""
    return [code for code, _ in row_code_cells(row, header, skip_names, context)]


def row_code_cells(row: str, header: str | None, skip_names: list[str] = (),
                   context: list[str] = ()) -> list[tuple[Code, list[int]]]:
    """row_codes, each code with the columns it was read from."""
    cells = _cells(row)
    heads = [h.lower() for h in _cells(header)] if header else []
    about_gpio = any('gpio' in heading.lower() for heading in context)
    found: dict[str, tuple[Code, list[int]]] = {}
    names = {canonical_token(n) for n in skip_names}

    def keep(code: Code, columns: list[int]) -> None:
        if code.code in names:
            return
        if code.code in found:
            found[code.code][1].extend(c for c in columns if c not in found[code.code][1])
        else:
            found[code.code] = (code, list(columns))

    # A flash pattern spread over two numeric columns.
    long_at = next((i for i, h in enumerate(heads) if 'long' in h), None)
    short_at = next((i for i, h in enumerate(heads) if 'short' in h), None)
    if long_at is not None and short_at is not None and max(long_at, short_at) < len(cells):
        long, short = cells[long_at], cells[short_at]
        if long.isdigit() and short.isdigit():
            code = f'FLASH:L{int(long)}S{int(short)}'
            keep(Code(code, flash_display(code), 'flash'), [long_at, short_at])
    for index, cell in enumerate(cells):
        head = heads[index] if index < len(heads) else ''
        if cell.isdigit() and ('gpio' in head or (about_gpio and any(w in head for w in ('bank', 'pin', 'line')))):
            keep(Code(f'GPIO{int(cell)}', f'GPIO {int(cell)}', 'gpio'), [index])
        # Any cell can hold the identifier a row is looked up by: a port such
        # as P102 sits under a column named after the chip ("RA4M1").
        for code in find(cell):
            keep(code, [index])
    return list(found.values())


def heading_codes(title: str, skip_names: list[str] = ()) -> list[Code]:
    """Identifiers named in a section heading ("Error E17", "exit status 74")."""
    names = {canonical_token(n) for n in skip_names}
    return [c for c in find(title) if c.code not in names]


# ------------------------------------------------------------ comparing codes

def edit_distance(a: str, b: str) -> int:
    """Damerau–Levenshtein (optimal string alignment): a swap of two
    neighbouring characters counts once, so E17 and E71 are one apart."""
    rows = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        rows[i][0] = i
    for j in range(len(b) + 1):
        rows[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            rows[i][j] = min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                rows[i][j] = min(rows[i][j], rows[i - 2][j - 2] + 1)
    return rows[-1][-1]


def did_you_mean(code: str, scheme: str, candidates: dict[str, tuple[str, str]], limit: int = 3) -> list[dict]:
    """Codes of the same scheme one edit (or one swap) away, closest first.
    ``candidates`` maps canonical code → (display, scheme)."""
    near = []
    for other, (display, other_scheme) in candidates.items():
        if other == code or other_scheme != scheme:
            continue
        distance = edit_distance(code, other)
        if distance <= 1 or (distance == 2 and len(code) >= 5):
            near.append((distance, other, display))
    return [{'code': c, 'display': d} for _, c, d in sorted(near)[:limit]]
