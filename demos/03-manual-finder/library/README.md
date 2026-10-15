# The sample library

Real documentation for six look-alike boards from two manufacturers, so
Finder can be tried without uploading anything:

| Family | Models | Revisions that matter |
|---|---|---|
| Raspberry Pi | Raspberry Pi 2 Model B, 3 Model B, 3 Model B+ | 2B v1.1 (BCM2836) and v1.2 (BCM2837): USB and network boot only on v1.2. 3B original (BCM2837) and later (BCM2837B0, metal lid): different GPIO boot-pin tables |
| Arduino UNO | UNO R3, UNO R4 Minima, UNO R4 WiFi | — |

Credit, licence (CC BY-SA 4.0), the changes made and the disclaimer are in
[NOTICE.md](NOTICE.md).

## Files

| File | What it is |
|---|---|
| `fetch_sources.py` | Downloads the chosen source files at pinned commits into `sources/` |
| `sources/` | The source files, unchanged, with each repository's licence |
| `models.json` | The models as the sources name them, products outside the library, and reviewed corrections |
| `build_corpus.py` | Turns `sources/` into `../corpus.json` and checks every unit against its source |
| `LICENSE.txt`, `NOTICE.md` | The licence and the attribution |

## Rebuild

From `demos/03-manual-finder`:

```bash
python3 library/fetch_sources.py              # only to refresh sources/
.venv/bin/python library/build_corpus.py      # writes ../corpus.json
```

The build prints, per manual, how many units it kept and how many it left
out (passages about other products, model-table rows for other models, and
passages left out by a reviewed correction). It refuses to write if any unit
is not the source's own words, or if a correction in `models.json` no longer
matches a passage.

## How passages get their models

Each unit records the models it applies to, decided in this order:

1. models named in the passage itself (whole names only: "3B" never matches
   inside "3B+"; the longest name wins);
2. for a table row, models named in the table's header (one column per model);
3. models named in the nearest heading above it;
4. otherwise every model the manual covers (a shared passage).

A passage that names only products outside the library is left out, so it
can never pass for a shared one. Where these rules are wrong for a real
passage, `models.json` carries a correction with its reason. Seven reviewers
read every unit against its source; their findings became those corrections.
A later review of the finished site added three more (the original 3B's GPIO
bank numbers, and two Help Center sections about boards outside the library),
32 in all.

A table's "Revision" column narrows each row to the revision it names, where
the column holds the model's own revisions: the 2B's rows for v1.1 and v1.2
narrow, and its row for 1.0, which the library doesn't define, applies to the
2B only when no revision is chosen. The 3B's rows in the same table name board
revisions (1.2, 1.3), while the library tells the 3B's SoCs apart, so they
narrow nothing.

## Limits

- The documentation is organised by topic, not by model, so tags come from
  how the text names the models. A sentence such as "Fixed in Raspberry Pi 3
  Model B+" needed a correction to stay visible to the boards that have the
  problem.
- A table with one column per model keeps every model's value in one row;
  the header labels the columns, but the model filter cannot isolate one
  column. Its codes can: a code read only from one model's column (the
  "ESP32" under "UNO R4 WiFi") is that model's code alone.
- The sources contradict themselves in places (for example on 3B+ USB host
  boot in `boot-usb.adoc`, which is why that file is not included). Answers
  cite passages; they do not settle what the hardware does.
