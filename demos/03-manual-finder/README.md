# Manual Finder (Finder)

Session 9 · Someone searching manuals by fault code, pin or plain-language
symptom, for one device model out of several look-alikes.

This folder holds two ways to run it:

- **Finder, the website** (FastAPI backend + Next.js frontend): model picker,
  exact-code lookup, cited answers, a search-mode lab and an evaluation page.
  See [WEB_README.md](WEB_README.md).
- **The learning demo** (Streamlit app and command line), unchanged in shape
  and now reading the same real manuals.

## The library

Real manufacturer documentation, CC BY-SA 4.0: Raspberry Pi 2 Model B,
3 Model B and 3 Model B+ (Raspberry Pi documentation) and Arduino UNO R3,
UNO R4 Minima and UNO R4 WiFi (Arduino documentation and Help Center).
`corpus.json` holds 1,014 units, each tagged with the models it applies to.
How it was fetched, split, tagged and reviewed: [library/README.md](library/README.md).
Credit and licence: [library/NOTICE.md](library/NOTICE.md).

## Run from the repository root

```bash
python -m streamlit run demos/03-manual-finder/app.py --server.address 127.0.0.1
python -m rag_core.cli --config demos/03-manual-finder/config.json ask "Which header pin is RA4M1 port P102?" --device uno-r4-wifi
python -m rag_core.cli --config demos/03-manual-finder/config.json ask "Which header pin is RA4M1 port P102?" --device uno-r4-minima
python -m rag_core.cli --config demos/03-manual-finder/config.json evaluate
```

The device IDs are `rpi-2b`, `rpi-3b`, `rpi-3b-plus`, `uno-r3`, `uno-r4-minima`
and `uno-r4-wifi`. Without `--device` the command-line demo asks for one. The
default is real keyword retrieval with source excerpts, **not generated
answers**; see the root README to enable local generation or semantic
retrieval.

## Demo sequence

1. Ask "Which header pin is RA4M1 port P102?" for the UNO R4 Minima, then for
   the UNO R4 WiFi: the same port is D5 on one and D13 on the other, and each
   board sees only its own row.
2. Ask a symptom, "The little red light on the board keeps flickering", for the
   Raspberry Pi 2 Model B: a paraphrase only semantic or hybrid search reaches
   reliably.
3. Ask without a device: Finder asks which model rather than guessing.
4. On the website's Lab page, run one query in all three modes and move the RRF
   constant to see how the fused order changes.

## Checks

- `evaluation.json`: the command-line regression set (keyword mode): exact
  codes on look-alike boards, a symptom, a known problem, a clarification and
  an absence.
- `queries.json`: the twelve labelled queries (exact codes, paraphrases, mixed
  wording, ambiguity) for the mode comparison. `compare_modes.py` runs them in
  keyword, semantic and hybrid mode and saves the ranked passage IDs per mode
  in `runs/`, with the actual hit counts in `runs/summary.json`.
- Wrong-model passages are excluded before ranking. The evaluation counts, in
  every top k, the passages the tags give to another model (a check that the
  filter applies the tags) and, independently of the tags, passages labelled by
  hand in `queries.json` as a look-alike board's answer (`forbidden`): none in
  any saved run.
- Rank fusion uses ranks, compared as exact fractions, never raw scores; ties
  go to the better single best rank, then the passage ID.

## Scope

Informational lookup only: Finder reports what the manuals say, with
citations, and gives no repair advice of its own. It controls no equipment.
