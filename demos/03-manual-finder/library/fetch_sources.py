"""Download the sample library's source files at pinned commits.

    python library/fetch_sources.py          # from demos/03-manual-finder

Every file is real manufacturer documentation published under the Creative
Commons Attribution-ShareAlike 4.0 licence (see library/README.md). Files are
fetched from raw.githubusercontent.com at the commits below and written,
unchanged, under library/sources/<repository>/, together with each
repository's licence. build_corpus.py reads them from there; nothing is
fetched at runtime.
"""
from __future__ import annotations

import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES = HERE / 'sources'

REPOSITORIES = {
    'raspberrypi-documentation': {
        'repo': 'raspberrypi/documentation',
        'commit': 'ddea98e98dafe9419feb4fd82710c2fbdef7dc44',
        'files': [
            'LICENSE.md',
            'README.md',
            'documentation/asciidoc/computers/raspberry-pi/boot-msd.adoc',
            'documentation/asciidoc/computers/raspberry-pi/bootmodes.adoc',
            'documentation/asciidoc/computers/raspberry-pi/boot-gpio.adoc',
            'documentation/asciidoc/computers/raspberry-pi/boot-net.adoc',
            'documentation/asciidoc/computers/raspberry-pi/power-supplies.adoc',
            'documentation/asciidoc/computers/raspberry-pi/frequency-management.adoc',
            'documentation/asciidoc/computers/raspberry-pi/revision-codes.adoc',
            'documentation/asciidoc/computers/configuration/led_blink_warnings.adoc',
            'documentation/asciidoc/computers/config_txt/conditional.adoc',
        ],
    },
    'arduino-docs-content': {
        'repo': 'arduino/docs-content',
        'commit': 'fcf130898e2ff105e96e0795ba561077c16efb44',
        'files': [
            'LICENSE.md',
            'README.md',
            'content/hardware/uno/boards/uno-rev3/datasheet/datasheet.md',
            'content/hardware/uno/boards/uno-r4-minima/datasheet/datasheet.md',
            'content/hardware/uno/boards/uno-r4-wifi/datasheet/datasheet.md',
            'content/hardware/uno/boards/uno-r4-minima/tutorials/cheat-sheet/cheat-sheet.md',
            'content/hardware/uno/boards/uno-r4-wifi/tutorials/cheat-sheet/cheat-sheet.md',
        ],
    },
    'arduino-help-center-content': {
        'repo': 'arduino/help-center-content',
        'commit': '2303fc899609b273d0748687a1798072b3e104a9',
        'files': [
            'LICENSE.md',
            'README.md',
            'content/Hardware Support/Generic/An-overview-of-different-UNO-boards.md',
            'content/Hardware Support/Generic/If-Arduino-UNO-Rev3-or-earlier-or-Mega-is-not-recognized-by-the-computer.md',
            'content/Hardware Support/Generic/My-board-PWR-Led-does-not-turn-on.md',
            'content/Hardware Support/Generic/Reset-your-board.md',
            'content/Hardware Support/Generic/What-power-supply-can-I-use-with-my-Arduino-board.md',
            'content/Hardware Support/UNO/Touch-reset-fails-for-UNO-R4-WiFi-on-Windows-Arduino-CLI-0-33-0-or-earlier.md',
            'content/Hardware Support/UNO/Whats-the-difference-between-UNO-R3-and-UNO-R4-boards.md',
            'content/Software Support/IDE Settings/COM-port-number-changes-when-connecting-board-on-different-ports-or-in-bootloader-mode.md',
            'content/Software Support/Upload/Failed-uploading-uploading-error-exit-status-1.md',
            'content/Software Support/Upload/If-your-board-is-not-detected-by-Arduino-IDE.md',
            'content/Software Support/Upload/dfu-util-errors-when-uploading-exit-status-74.md',
        ],
    },
}


def raw_url(repo: str, commit: str, path: str) -> str:
    return f'https://raw.githubusercontent.com/{repo}/{commit}/{urllib.parse.quote(path)}'


def main() -> int:
    for folder, spec in REPOSITORIES.items():
        for path in spec['files']:
            target = SOURCES / folder / path
            target.parent.mkdir(parents=True, exist_ok=True)
            url = raw_url(spec['repo'], spec['commit'], path)
            with urllib.request.urlopen(url, timeout=30) as response:
                target.write_bytes(response.read())
            print(f'{folder}: {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
