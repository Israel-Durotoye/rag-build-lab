# Finder — Python backend + Next.js frontend

Finder finds **the exact passage for the exact model** in device manuals. It
is for anyone who juggles look-alike products, such as a support agent with
a queue of tickets for boards whose names differ by one character. Pick the
model you are working on, ask by fault code, pin, part number or symptom,
and get a cited answer drawn only from that model's passages.

The idea this site demonstrates is **filtering by metadata before ranking,
and three kinds of retrieval**. Every manual is split into small units
(a paragraph, a list item, a table row), and each unit records the device
models and revisions it applies to. A lookup table of six boards becomes six
units, each tagged with its own board, so the "P102" row for the UNO R4 WiFi
can never answer a question about the UNO R4 Minima. Keyword, semantic and
hybrid search then run over the chosen model's units only, and the Lab page
shows all three side by side, with the rank-fusion arithmetic written out.

```text
browser ──► Next.js (UI, proxies /api/*) ──► FastAPI backend (Python)
                                             ├─ rag_core.web.extraction · ocr     PDF, Word, text (shared)
                                             ├─ sectioning.py                     sections → units (rows keep their header)
                                             ├─ variants.py                       model names in text; unit tags
                                             ├─ identifiers.py                    codes, pins, ports, LED patterns
                                             ├─ rag_core Index (SQLite FTS5)      stemmed BM25 over every unit
                                             ├─ rag_core.web.embeddings           FastEmbed (bge-small-en-v1.5)
                                             ├─ rag_core.web.retrieval            filter, keyword, semantic, RRF
                                             ├─ clarify.py                        when to ask which model or revision
                                             ├─ cards.py                          exact-code lookup, code matrix
                                             ├─ context.py · prompting.py         section as the model sees it; rules
                                             ├─ lab.py · evaluation.py · guide.py three modes; labelled queries; look-alikes
                                             └─ rag_core OpenAICompatible         any OpenAI-compatible chat API
```

The frontend and backend share API contract version `1`. FastAPI returns it in
the `/api/status` body and the `X-Manual-API-Version` header on every
response; the Next.js client rejects an older or newer backend with an
explicit deployment error. When the contract changes, update both constants
and deploy both halves.

The look is a low-light soft UI: surfaces are raised out of, or pressed into,
one dim base colour, with a light theme a click away. Typefaces: Manrope for
text, IBM Plex Mono for identifiers, and Doto, a dot-matrix face, for codes
drawn like a device's own display. All are self-hosted at build time.

## The sample library

Real documentation, never written for this repository: the Raspberry Pi
documentation (Raspberry Pi 2 Model B, 3 Model B and 3 Model B+) and the
Arduino documentation and Help Center (UNO R3, UNO R4 Minima and UNO R4
WiFi), all CC BY-SA 4.0. Two models have revisions that change the answers:
the 2B v1.1 and v1.2 (USB and network boot only on v1.2), and the original
3B (BCM2837) and the later 3B with the metal lid (BCM2837B0), whose GPIO
boot-pin tables differ. See [library/README.md](library/README.md) for how
the library is built and checked, and [library/NOTICE.md](library/NOTICE.md)
for credit, changes and the disclaimer.

## The pages

| Page | What it does |
|---|---|
| **Search** | One search box and the "Working on" model. The answer arrives with a fault card when the question names a code, the explanation with numbered citations, the manual's own warnings, and the passages, each shown as its section looks to the chosen model (lines for other models hidden behind a toggle, greyed). Passages from other models that also matched are listed apart. "Same question, other model" runs the question on a second model side by side, marking what differs. |
| **Chat** | The same answers as a conversation, for follow-ups. Earlier questions are carried; earlier answers never are. |
| **Codes** | Every code × every model: pins, ports, GPIO numbers, LED flash patterns, revision codes, error messages. Rows where models disagree are marked. |
| **Models** | "Which model do I have?": the passages that say how to identify each board, its revisions, and how it differs from its look-alikes (codes that mean something else, table rows that differ). |
| **Lab** | One query through keyword, semantic and hybrid search, with the same filter. Lines join the same passage across the columns; each hybrid score is written out; the RRF constant is a slider and the fused list re-ranks in the browser. |
| **Evaluate** | The twelve labelled queries through every mode: hits and ranks, wrong-model passages by the tags, look-alike passages labelled by hand (a check that doesn't rely on the tags), the exact-code lookup measured apart, and whether Finder asked when it should. Runs are saved and downloadable. |
| **Library** | The sample library and your own manuals (PDF, Word, text, Markdown). For an upload you list the models it covers (suggestions are offered) and its passages are re-tagged; a manual's page shows every passage as any chosen model would see it, and how each tag was decided. |
| **Inspect** | Every step of one answer: what was read in the question, the filter, the three rankings and the fusion, the context with what was hidden, and the exact prompt. |
| **Settings** | Answer style, extra instructions, the "not found" sentence, search mode, matches per question, the RRF constant, the context budget, the theme, and the single-key shortcuts. The grounding rules and the always-ask policy are shown, not editable. |

`/` focuses the search box from anywhere; `m` opens the model picker. Both
can be turned off in Settings. On a phone the dock keeps Search, Chat, Codes and
Models, with the other pages under More.

## How each layer works

1. **Reading a manual.** `POST /api/documents` streams progress as
   newline-delimited JSON. Extraction is the shared code in `rag_core/web`:
   PyMuPDF reads PDF text, RapidOCR reads scans and text in images,
   python-docx reads Word files.
2. **Sections and units.** `sectioning.py` starts a section at each heading
   and splits it into units: each table row (with its header line), each list
   item when items name different models, paragraphs (split past 120 words),
   notes.
3. **Models.** `variants.py` finds model names in text. A name matches only
   whole ("3B" never inside "3B+"), the longest name wins ("Nano 33 BLE Sense"
   is never read as "Nano 33 BLE"), a family name stands for its members,
   enumerations continue a name ("Raspberry Pi 1, 2, 3, and 4"), and a
   revision label counts only beside its own model. A unit applies to the
   models it names; failing that, those its table header or nearest heading
   names; failing that, every model its manual covers. Names of products
   outside the library mark a unit as theirs, so it is never taken for a
   shared one. For an upload you list the models; the sample library adds
   reviewed corrections (`library/models.json`).
4. **Codes.** `identifiers.py` reads identifiers the same way in manuals and
   questions: LED flash patterns ("4 long · 4 short"), GPIO numbers, ports and
   pins (P102, D13), hex values, config filters ([pi3+]), "exit status 74",
   and letter-and-digit codes; spellings are normalised, so "gpio-22" is read
   as "GPIO 22" (shown as a "Read as" chip). Every table row is indexed under
   each identifier in it.
5. **Which model.** `clarify.py`: a model named in the question is used
   (ambiguous names and a clash with the picker are asked about); otherwise
   the picker's model; with neither, Finder **always asks**, listing every
   model with those whose passages match the question first, and nothing of
   what each manual says. When the chosen model's revisions disagree on the
   question (by rule: the passages differ once model and revision names are
   removed), it asks which revision.
6. **Exact codes.** `cards.py` looks the question's most specific code up in
   the model's code tables. A hit becomes the fault card and is pinned first
   in the context ("exact code match", not a rank); a miss says the code is
   not in that model's manual and offers the nearest codes it does have.
7. **Retrieval.** The filter comes first: only units that apply to the chosen
   model and revision may be ranked. Keyword search ranks them by BM25 over
   stemmed words; semantic search by cosine similarity of bge-small-en-v1.5
   vectors; hybrid fuses the two lists by reciprocal rank fusion,
   sum(1 / (constant + rank)), never by adding raw scores. Scores are compared
   as exact fractions; a tie goes to the passage with the better single best
   rank, then to the passage ID. The same search over the other models' units
   fills the "left out" panel.
8. **Context.** `context.py` turns each match into its section as the chosen
   model sees it, within a word budget; lines for other models are removed
   before the model reads anything and kept in the trace. Sentences with
   warning words are quoted beside the answer.
9. **Generation.** `prompting.py` tells the model to answer only from the
   numbered passages, cite them, add no steps or repairs the manual does not
   contain, repeat its warnings, and start with the "not found" sentence when
   they do not answer. Citations are checked afterwards. Without a key, or when
   the provider fails, the manual's own sentences are shown, labelled as such.

## Workspaces and storage

Each browser creates a random 32-character workspace ID and sends it with every
request, so visitors never see each other's manuals. This is isolation, not
authentication. Manuals, the index, vectors, settings and evaluation runs live
under `MANUAL_DATA_DIR` (default `demos/03-manual-finder/.state`, gitignored);
embeddings are cached by content, so the sample library is embedded once per
server; an upload's are not shared, so no browser can tell what another
uploaded. A workspace is created by its first write (loading the sample,
an upload, saving settings); reading with a new ID creates nothing. Beyond 64
open workspaces, idle ones are closed until next used, and workspaces unused
for 7 days are deleted when the server starts and about once an hour after.

## Run locally

Two processes, both from `demos/03-manual-finder`.

**1. Python backend** (Python 3.11+):

```bash
cd demos/03-manual-finder
python3.11 -m venv .venv
.venv/bin/python -m pip install -e ../.. -r backend/requirements.txt
cp .env.example .env.local      # then set MANUAL_MODEL_API_KEY (or reuse another site's .env.local)
npm run api                     # uvicorn on http://127.0.0.1:8002
```

If Campus Guide or Study Companion is set up, its `.env.local` works here
unchanged (the `AGENTROUTER_*` names are read), and copying its `.state/models`
folder saves the embedding model download (~70 MB).

**2. Next.js frontend** (Node.js 22), in a second terminal:

```bash
npm ci
npm run dev                     # http://localhost:3002
```

The ports differ from Campus Guide's (8000, 3000) and Study Companion's (8001,
3001), so all three sites can run at once.

## Check the implementation

```bash
npm run test:api   # backend
npm run lint
npm run typecheck
npm test           # frontend
npm run build
.venv/bin/python compare_modes.py     # the labelled queries in every mode → runs/
.venv/bin/python library/build_corpus.py   # rebuild and re-check the sample library
```

From the repository root, `python -m pytest -q` and
`python scripts/evaluate_all.py` cover `rag_core` and all ten demos, including
this one's command-line path. See [WEB_RUN_RESULTS.md](WEB_RUN_RESULTS.md) for
what was actually run.

## Deploy

Nothing here publishes anything by itself. The steps are the ones Study
Companion uses.

```bash
./hf-space/deploy-space.sh <owner>/finder-api --dry-run   # assemble only
./hf-space/deploy-space.sh <owner>/finder-api --public    # create or update the Space
```

Then add the secret `MANUAL_MODEL_API_KEY` on the Space, and use a provider that
accepts datacenter traffic (see `hf-space/README.md`). For the frontend on
Vercel: Root Directory `demos/03-manual-finder`, Node.js 22, `MANUAL_API_URL`
set to the Space URL **before building**. Check either half with
`./check-deploy.sh <url>` (add `--full` to load the sample library and ask on two
look-alike boards).

## Remaining limits

- Tags come from how the text names models. They are reviewed for the sample
  library, but an upload is only as well tagged as its model list and its
  wording; check a manual's page with "View as".
- A table with one column per model keeps every model's value in its row; the
  header labels them, but the filter cannot hide one column.
- A valid citation shows the passage was in the prompt, not that every claim
  follows from it, so passages are always one click away.
- Semantic search always returns its nearest passages; when no word of the
  question matched, the reply says so.
- When the model provider stalls, an answer waits up to
  `MANUAL_MODEL_TIMEOUT_MS` (60 s) for each of `1 + MANUAL_MODEL_RETRIES` (3)
  attempts before the manual's own sentences stand in; the fault card and the
  passages are on screen first. Meanwhile the stream sends a blank line every
  10 s, so a proxy with an idle timeout (the Next.js rewrite allows 30 s)
  keeps it open. Lower both settings for a quicker fallback.
- Uploads are processed one at a time, and bounded: 40 MB a file, checked
  before the body is read; at most 4 being received and 4 waiting to be read
  (more are refused straight away, not queued); text beyond 2 million
  characters, or a PDF beyond 2,000 pages, is not read and the manual is
  marked truncated; a Word file that would unpack to more than 100 MB (or
  25 MB of XML) is refused before it is opened. A single PDF page whose
  compressed content unpacks to a huge size is not caught by these limits:
  run the backend with a memory limit.
- There is no authentication, rate limiting, reranker or answer cache. Anyone
  who can reach the backend can create workspaces and spend the model key, so
  put it behind a gateway with rate limits before opening it widely.

PyMuPDF is licensed under the AGPL-3.0: if you run a modified backend as a
network service, its source must be available to users (this repository is
public).
