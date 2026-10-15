# Notice: the sample library

The sample library (`../corpus.json` and the files under `sources/`) is real
manufacturer documentation, used under the Creative Commons
Attribution-ShareAlike 4.0 International licence
(<https://creativecommons.org/licenses/by-sa/4.0/>; full legal code in
`LICENSE.txt`). The adapted excerpts in `corpus.json` are released under the
same licence. Finder's own code is not part of this licence.

## Sources and credit

| Source | Copyright | Licence | Files (pinned commit) |
|---|---|---|---|
| Raspberry Pi documentation, <https://www.raspberrypi.com/documentation/> | © 2012–2026 Raspberry Pi Ltd. Some content originates from the eLinux wiki (CC BY-SA 3.0 Unported). | CC BY-SA 4.0 | <https://github.com/raspberrypi/documentation/tree/ddea98e98dafe9419feb4fd82710c2fbdef7dc44> |
| Arduino documentation, <https://docs.arduino.cc> | © Arduino | CC BY-SA 4.0 | <https://github.com/arduino/docs-content/tree/fcf130898e2ff105e96e0795ba561077c16efb44> |
| Arduino Help Center, <https://support.arduino.cc> | © Arduino | CC BY-SA 4.0 | <https://github.com/arduino/help-center-content/tree/2303fc899609b273d0748687a1798072b3e104a9> |

The exact files are listed in `fetch_sources.py`; `sources/` holds them
unchanged, with each repository's own licence file. Retrieved 2026-10-15.

Both repositories' licence files open with the sentence "licensed under a
Creative Commons Attribution 4.0 International Licence" but link to the
BY-SA 4.0 licence and contain its legal code; the stricter BY-SA reading is
applied here.

## Changes made

- Split into sections and units (paragraphs, list items, table rows, notes,
  short code blocks); markup (AsciiDoc, Markdown, HTML, link targets,
  anchors, comments) removed. The wording is unchanged: `build_corpus.py`
  checks every unit against its source file before writing.
- Some sections left out: certifications and legal notices, translations,
  pages about products outside the library, code longer than twelve lines,
  and passages that name only products outside the library.
- Each unit is tagged with the device models it applies to, by the rules in
  `backend/variants.py` and the reviewed corrections in `models.json` (each
  with its reason).

## Trademarks and endorsement

Raspberry Pi and Arduino are trademarks of their owners; the licence does not
grant trademark rights. Product names are used only to identify the hardware
the documentation describes. Finder is not affiliated with or endorsed by
Raspberry Pi Ltd or Arduino.

## Disclaimer

As section 5 of the licence states, the licensed material is offered as-is
and as-available, without warranties of any kind. Finder shows what the
manuals say; it does not give repair advice or control any equipment.
