# Finder website — what was actually run

Checked locally on 15 October 2026, on macOS 12.7.6 (Intel). **Not deployed.**
The deployment script was run only with `--dry-run`, which assembles the Space
folder on this machine and uploads nothing (see the first table).

## Tested versions

Python 3.11.2, SQLite 3.39.4 (as built into that Python), Node.js 24.21.0,
Next.js 16.3.6, React 19.3.0, TypeScript 6.0.3, ESLint 9.39.5, FastAPI 0.143.1
(Starlette 1.8.0), uvicorn 0.54.0, PyMuPDF 1.28.2, RapidOCR 3.10.0,
onnxruntime 1.19.2, FastEmbed 0.9.0 with BAAI/bge-small-en-v1.5, NumPy 2.4.6,
openai 3.31.0, python-docx 1.2.0, pytest 9.1.1. `package.json` asks for
Node.js 22, as the other two sites do; npm warns about the engine on 24, and
everything below passed on 24. Browser checks used headless Google Chrome
150.0.7871.125 driven by playwright-core 1.63.0. Exact frontend dependencies
are in `package-lock.json`.

## Automated checks

Run inside `demos/03-manual-finder` unless a row says otherwise; the final
round, after every change below.

| Command | Result |
|---|---|
| `npm run test:api` | 293 passed |
| `npm run lint` | Passed, no errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | 38 passed, 0 failed, 0 skipped |
| `npm run build` | Production build passed; 12 routes |
| `.venv/bin/python -m pip check` | No broken requirements |
| `.venv/bin/python library/build_corpus.py` | Rebuilt `corpus.json` from the pinned sources: 1,014 passages in 9 manuals |
| `.venv/bin/python compare_modes.py` | Wrote `runs/` (results below) |
| Repository root: `python -m pytest -q` | 88 passed |
| Repository root: `python scripts/evaluate_all.py` | 36/36 across ten demos, including this demo's nine command-line cases |
| `demos/01-campus-desk`: `npm run test:api` | 101 passed (the shared `rag_core/web` changed) |
| `demos/02-study-companion`: `npm run test:api` | 78 passed (likewise) |
| `./hf-space/deploy-space.sh example/finder-api --dry-run` | Assembled 50 files and stopped before any upload. Started with uvicorn from that folder alone (no model key, its own data folder), it answered `/api/status` with contract version 1, loaded the sample library, and gave the R4 Minima's P102 card (D5) |

The backend tests use a deterministic fake embedder and a scripted model
client. They cover the sample library build, model and revision tagging,
code reading, uploads and the model-naming step, filtering before ranking in
every mode, rank fusion and its tie rule, when Finder asks, fault cards, the
context and its budgets, citation checks, the fallback to the manual's own
sentences, follow-ups, the codes matrix, the models guide, the lab, the
evaluation, settings, workspace isolation, the API contract header, and what
one request or file can cost the server (`test_limits.py`). Each finding of
the reviews below has a test of its own.

## Labelled queries

Twelve questions over the sample library (`queries.json`), with the settings
`compare_modes.py` and the Evaluate page use: the top 5 passages, RRF
constant 60, ties to the better best single rank. This is a small check of
retrieval and of when Finder asks, not a benchmark of answer quality. The same
totals came out of the Evaluate page in the browser and out of
`compare_modes.py` (saved in `runs/summary.json`), before and after the
library was rebuilt.

| Query | Model | Hybrid | Keyword | Semantic | Exact-code lookup |
|---|---|---|---|---|---|
| q01 What does GPIO 22 select in GPIO boot mode? | 3B+ | — | — | — | found |
| q02 Which header pin is RA4M1 port P102? | R4 WiFi | 5 | 1 | — | found |
| q03 Device Manager lists my board as ATmega16u2 DFU… | UNO R3 | 2 | 2 | 3 | another passage |
| q04 My Pi gets noticeably slower once it's only slightly warm… | 3B+ | 5 | — | 3 | |
| q05 The little red light on the board keeps flickering… | 2B | 3 | 1 | — | |
| q06 After I made it act as a USB keyboard… | R4 WiFi | 1 | 2 | 3 | |
| q07 Upload fails with exit status 74 | R4 Minima | 1 | 1 | 1 | found |
| q08 Network boot stalls when the TFTP server is on a different subnet | 3B | 1 | 1 | 1 | |
| q09 Do I need program_usb_boot_mode=1 to boot my 3B+ from USB? | 3B+ | 3 | — | 2 | |

The number is the rank of the labelled passage; — means it was not in the top
5.

- **Hybrid 8 of 9, keyword 6 of 9, semantic 6 of 9.** No mode put q01's
  labelled passage in its top 5, but the exact-code lookup reads that row
  straight from the 3B+'s table, so the answer still starts from it.
- **Exact-code lookup 3 of 4.** For q03 the card comes from the UNO R3
  datasheet's board topology row; the labelled passages are the Help Center
  article on boards that are not recognised.
- **Clarification 3 of 3.** "Does my Pi 3 boot from USB out of the box?" with
  no model asks between the 3B and the 3B+; "Which header pin is port P102?"
  with no model offers all six boards and marks exactly the two whose manuals
  have P102; GPIO 22 on the 3B asks between BCM2837 and BCM2837B0.
- **Look-alike passages: 0.** Four questions carry passages labelled by hand
  as a look-alike board's answer (`forbidden` in `queries.json`: the original
  3B's GPIO 22 row for the 3B+, the R4 Minima's P102 row and HID passages for
  the R4 WiFi, the 2B and 3B's OTP steps for the 3B+). None reached a top 5
  in any mode. This check doesn't rely on the tags. The other count,
  wrong-model passages (also 0), uses the same tags as the filter, so it shows
  only that the filter applies them.

## Browser checks

Production build (`npm run start`) against the backend on port 8002, driven
with Playwright and headless Chrome. Screenshots and scripts stayed in a
scratch folder and are not committed. The final round ran on the final code.

**Every page** (Search, Chat, Codes, Models, Lab, Evaluate, Library, a
manual's page, Inspect, Settings) at 1440 × 900 and 390 × 844, in the dark and
the light theme, with the sample library loaded, and every page with an empty
library at 1440 × 900: 49 page loads with no page error, console error or
warning, failed request, HTTP error status or horizontal overflow.

**Flows**, each in a fresh browser profile, 21 in all, all passing:

- **No model chosen.** "Which header pin is port P102?" asked which model,
  offering the six boards with the R4 Minima and R4 WiFi marked. Choosing the
  R4 Minima set the picker and answered with the P102 card (Pin D5, RA4M1
  P102, timer GTIOC2B), marked "Means something else in R4 WiFi". "Same
  question, other model" with the R4 WiFi showed both side by side, the WiFi
  card reading D13.
- **Revisions.** With the 3B chosen (opened with `m`, filtered by typing
  "3B"), GPIO 22 asked between BCM2837 (original) and BCM2837B0 (metal lid);
  BCM2837B0 gave the card for NAND. GPIO 20 asked too ("GPIO 20 is only in
  the table for the BCM2837B0 (metal lid)"); choosing the original said "GPIO
  20 isn't in the Raspberry Pi 3 Model B (BCM2837 (original)) manual" and
  offered GPIO 22. On the 2B with no revision, the quoted OTP steps carried an
  "Only v1.2" tag.
- **Codes while typing.** "P10" with the R4 Minima chosen listed P102, P104,
  P106 and P109 with their rows. "Upload fails with exit status 47" said the
  R4 Minima's manual doesn't have it, with "Did you mean exit status 74".
- **Lab.** q02 ran the three modes for the R4 WiFi; the P102 row was 5th in
  the hybrid column at constant 60 and 2nd at constant 1, re-ranked in the
  browser.
- **Evaluate.** "Run the queries" gave the totals above, look-alike tile
  included.
- **Codes.** 206 codes, 70 that differ between models; filtering by "P102"
  left 2; a cell opened its panel with the row under its column names.
- **Models, a manual's page, Inspect, Settings.** The 3B's guide opened at
  `/models?model=rpi-3b`; "Find in this manual" searched the Raspberry Pi
  hardware manual; "Inspect this answer" showed all five steps; settings
  stayed saved after a reload; the shortcuts switch turned `m` off and on.
- **Chat.** After an answer for the R4 Minima, "And on the UNO R4 WiFi?" asked
  which of the two boards was meant, since the picker said R4 Minima.
- **Theme and keys.** The theme toggle switched to light and stayed light
  after a reload. `/` focused the Codes page's own filter, and from the
  Models page went to Search with its box focused. `m` opened the model
  picker; Escape closed it and returned focus to its button.
- **Phone.** The dock showed Search, Chat, Codes, Models and More; More opened
  the other five pages and the credit, went to Library and closed, and
  Escape closed it.
- **Upload.** In a workspace with the sample library, uploading the Help
  Center article "Reset your board" (`Reset-your-board.md`, from the sample's
  own CC BY-SA sources) added it as the tenth manual with a warning that its
  models were not confirmed, and answers drawing on it carried "Models not
  confirmed". Confirming it as "UNO R4 WiFi" joined the sample's UNO R4 WiFi
  (still six models) and re-tagged its passages.

## Model-written answers

Earlier on 15 October, before the browser checks, `./check-deploy.sh
http://127.0.0.1:8002 --full` ran against the local backend with the
AgentRouter key: the P102 answers for the R4 Minima (D5) and the R4 WiFi
(D13) were written by the model with valid citations and no passage from the
other board, and a question with no model asked with six choices.

From about 02:40 to at least 04:20 WAT the provider stopped answering: every
request to `deepseek-v4-flash` timed out with no output, including a one-word
request sent directly with the openai client (five tries), while AgentRouter's
model list still answered in about a second. So the browser flows ran
against a backend started with `MANUAL_MODEL_TIMEOUT_MS=20000` and
`MANUAL_MODEL_RETRIES=0`, and every answer in them is the fallback: the fault
card, then "The model couldn't be reached, so these are the manual's own
sentences, not a written answer". With the default settings one answer
through the Next.js server took 186 s (three attempts of 60 s), stayed open
throughout, and ended with status `unavailable` and the same fallback.

## Reviews, and what changed

After the first browser round, three reviewers read the finished site, each
without changing anything: one for security, one for the model filter, one
for the frontend. Each finding was reproduced before it was fixed, and each
fix has a test.

**Security** (two high, two medium, three lower):

- A file whose text had a long run of digits before a "+", or a long run of
  spaces after "1 long" or "gpio", took time growing with the square of its
  length to parse (7.8 s for 8 KB), holding the server. The patterns are now
  bounded and a table rule is checked cell by cell; 32 KB of each now parses
  in about a tenth of a second, and the tests hold 64 KB to under 2 s.
  Passages are also cut at 2,000 characters.
- A Word file was unpacked whole before any check, and a small PDF could
  repeat one large content stream on every page. Reading now stops at the
  2-million-character document limit and 2,000 PDF pages (the manual is
  marked truncated), and a Word file whose parts would unpack to more than
  100 MB (25 MB of XML) is refused before it is opened. This is in the shared
  `rag_core/web/extraction.py`, so the other two sites have it too.
- An upload's size was checked only after the whole body had been spooled to
  disk, with up to 1,000 file parts. The size is now checked from its header
  first, one file part is allowed, and at most 4 uploads are received and 4
  wait to be read at once; more are refused straight away.
- Any new workspace ID created a folder, a SQLite file and an open connection
  that lasted until a restart, even on a read. Reading now creates nothing;
  beyond 64 open workspaces idle ones are closed; expired ones are removed
  hourly, not only at startup.
- The first passage of the context could exceed any budget (the reviewer
  measured a 1.2 MB prompt). The context is now bounded in characters as
  well as words.
- Re-tagging and waiting for the embedding model ran on the event loop; they
  now run off it, and a question asked while the model loads goes by keyword.
- The embedding cache was shared between workspaces, so an upload's speed
  could reveal that another browser had uploaded the same file. Only the
  sample library's vectors are shared now.

**The model filter** (ten findings), with the sample library rebuilt and its
changes compared passage by passage:

- When no model writes the answer, the manual's sentences were picked by
  word overlap, so a sentence about the Pi 4 or Pi 5 inside a passage that
  also covers the 3B+ could be quoted. A sentence naming only other products
  is now left out, of quotes and of safety notes.
- Two Help Center sections about boards outside the library (the retired UNO
  WiFi, and other makers' "UNO" clones) were tagged as the UNO R3; they are
  left out by a reviewed correction.
- In the table with one column per board, every code in a row was credited
  to all three UNOs ("ESP32 on the Arduino UNO R3"). A code read only from
  board columns now belongs to those boards.
- A code in only one revision's table (GPIO 20, a boot pin only on the 3B
  with the BCM2837B0) was shown as the 3B's with no revision chosen. Finder
  now asks which revision, as it does for GPIO 22. A revision code
  ("a01041") names its own revision, so it doesn't ask.
- Quoted sentences lost their "(Only v1.2)" qualification, and a label with
  brackets of its own ("BCM2837 (original)") broke it. Each quoted sentence
  and safety note now carries the revisions it is limited to, shown as a tag
  beside the verbatim text.
- A row of the revision-code table naming a revision the library doesn't
  define ("a01040 | 2B | 1.0") applied to every revision; it now applies to
  the 2B only when no revision is chosen. The 3B's rows in that table name
  board revisions, not the SoCs the library tells apart, so they are
  unchanged.
- An answer from an upload whose models weren't confirmed didn't say so; its
  card and sources now do.
- The evaluation's wrong-model count re-used the tags it was meant to check;
  hand-labelled look-alike passages now check them independently (above).
- A revision label next to one model could be attached to another further
  away ("the 3B and 3B+ (BCM2837B0)"); the nearest mention now decides. No
  sample passage changed.
- A correction gave the 3B+ the original 3B's GPIO bank numbers (22-26 and
  39-43; its own table starts at 20 and 37); that passage is now the original
  3B's only.

**The frontend** (four medium, six low): asking again while an answer
streamed brought back the old answer marked "Stopped"; Chat's Clear stopped
a Search answer (they now have separate controllers); "New topic" pressed
during a follow-up was undone when it finished; the keyword fallback while
the embedding model loaded could stick for the session; numbered steps
separated by blank lines or a warning restarted at 1; highlighting missed
stemmed forms ("flashing" and "flashes") and marked "pi" inside "pinout"; a
stored revision without a model, or a selection storage refused to write, was
kept; closing the model picker always focused the top bar, even when Search
or Chat had opened it; the single-key shortcuts couldn't be turned off (they
can now, in Settings); four pages had no title of their own.

**Found in the browser checks themselves:**

- The Next.js rewrite closes a response that sends nothing for 30 s, so a
  slow model turned into a dropped connection. `rag_core/web/http.py`'s
  `ndjson` now takes an optional `heartbeat`, a blank line after that many
  quiet seconds (every NDJSON reader here skips blank lines); Finder sends one
  every 10 s. The other two sites don't pass it, so their streams are
  unchanged.
- A dropped stream now says so ("The connection dropped before the answer
  finished") instead of "Something went wrong".
- Three pages sat off-screen in a sideways-scrolling phone dock; it now has a
  More sheet, which also carries the credit on phones.
- With a code in a "Which model?" question, every board whose passages shared
  a word was marked as matching; now it's the boards whose manuals have the
  code.
- Beside sentences sharing two or more words with the question, the fallback
  no longer quotes one that shares a single word ("port" in "the COM port
  number").
- The Codes panel shows a table row under its column names; the comparison's
  narrow column shows only the running step's label; small codes in the
  dot-matrix face are drawn at full weight; GPIO codes read "GPIO 20"
  everywhere.
- A new model row naming a model the library already has ("UNO R4 WiFi")
  became a look-alike beside it; it now joins it. Model-name suggestions no
  longer join words across a menu path ("File > Examples > 01.Basics").

## Not checked

- Deployment, by instruction: no Space, no Vercel project.
- Model-written answers in the browser, because of the provider outage above.
- Screen readers. Labels, roles, focus and live regions were checked in code
  and through Playwright's accessibility queries only.
- Browsers other than Chrome, and real phones.
- Uploading a scanned PDF through the browser; OCR is covered by the backend
  tests with generated images.
- A PDF page whose compressed content unpacks to a huge size is not bounded
  by the limits above, and there is no rate limiting; both are listed in
  `WEB_README.md`.
