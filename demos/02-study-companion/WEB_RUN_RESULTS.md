# Study Companion website — what was actually run

Checked locally on 29 September 2026, on macOS 12 (Intel). Nothing was
deployed: no Space, no Vercel project, no other hosted resource was created.

## Tested versions

Python 3.11.2, SQLite 3.39.4 (as built into that Python), Node.js 22.17.0,
Next.js 16.3.6, React 19.3.0, TypeScript 6.0.3, FastAPI 0.141.1, uvicorn 0.54.0,
PyMuPDF 1.28.2, RapidOCR 3.9.2, onnxruntime 1.19.2, FastEmbed 0.8.1,
NumPy 2.4.6, openai 3.20.0, pytest 9.1.1. Exact frontend dependencies are in
`package-lock.json`.

## Automated checks

Run inside `demos/02-study-companion` unless a row says otherwise.

| Command | Result |
|---|---|
| `npm run test:api` | 78 passed |
| `npm run lint` | Passed, no errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | 31 passed, 0 failed, 0 skipped |
| `npm run build` | Production build passed; 11 routes |
| `python -m pip check` (this demo's environment) | No broken requirements |
| `./hf-space/deploy-space.sh <name> --dry-run` | Assembled 41 files; the assembled folder started on its own and served the sample notes. Nothing was uploaded |
| Repository root: `python -m pytest -q` | 87 passed (86 before; one new test for joining a short last window) |
| Repository root: `python scripts/evaluate_all.py` | 30/30 across ten demos |
| Repository root: `python demos/02-study-companion/compare_chunking.py` | Reproduced the saved `runs/chunking-section.json` and `runs/chunking-fixed.json` exactly (apart from the timestamp), so the command-line demo is unchanged |

Campus Guide, whose backend now imports the shared code from `rag_core/web`,
was checked again from `demos/01-campus-desk`: `npm run test:api` 101 passed,
`npm run lint` and `npm run typecheck` passed, `npm test` 12 passed,
`npm run build` passed, and the Space dry run assembled a folder that started
and answered `/api/status` with contract version 2.

The backend tests use a deterministic fake embedder and a scripted model
client. They cover sectioning (headings, long headings split into parts, short
tails), uploads of Markdown, text and PDF, both chunkings and their vectors,
re-chunking after a change of chunk size or rules, workspace isolation, the
question pipeline with and without a model, citation checks, the "not found"
sentence, follow-ups that carry questions and never answers, parent expansion
and the word budget, caveats, the comparison, quiz and flashcard checks
(dropped items, unverified quotes, shuffled options), recall cards, settings
validation and the API contract header on every kind of reply.

## Browser checks (production build, headless Chromium, 1440 × 900 and 390 × 844)

Driven with Playwright against `npm run start` and the backend on port 8001.
No page error, console error, console warning or HTTP error status was recorded
in any run. Screenshots are in `reports/` (not committed).

- **Sample notes.** Home listed the notes with a model-written summary and key
  terms. On Ask, "Does negative feedback guarantee stability?" streamed an
  explanation that began "No. Negative feedback does not guarantee stability",
  with the **Watch for** box quoting "Important exception: negative feedback
  does not guarantee stability." Clicking a citation opened its section, and
  **Open in the original notes** went to Notes with that section highlighted.
  Returning to Ask kept the conversation.
- **Follow-up.** "What about delay?", asked with fixed-length chunks, was read
  as a follow-up; the model rewrote the query to "negative feedback stability
  with delay"; two supporting sections were marked *expanded to section*.
- **How it works.** Retrieval, Context and Generation each showed the chosen
  question's trace, including the prompt as sent, in which the earlier
  question appeared and no earlier answer did.
- **Compare.** One question ran against both chunkings, then the sample set of
  eight. With keywords + meaning, 5 matches, a 600-word budget and 50-word
  windows, the expected sections all reached the context in 7 of 7 questions
  for both chunkings; section-aware used 325 context words on average and
  fixed-length 282.
- **Practise.** A saved quiz and a saved set of flashcards were opened, a wrong
  option chosen (the right one was then marked, with the reason and the quoted
  sentence), the quiz finished and the result shown; a flashcard was turned
  over.
- **Uploads.** A two-page PDF and a Markdown file were added together through
  the upload box. The PDF became 5 sections cited by page ("p. 1", "p. 2"); the
  Markdown file became 9, a 766-word heading having been split into six parts.
  "Can heat flow from cold to hot?" was answered from the PDF with the caveat
  "…unless work is done on the system, as in a refrigerator" quoted beside it.
- **Fragments.** With fixed-length chunks and expansion off, supporting
  sections were tagged *fragment*, and **Show the whole section** displayed the
  parent section with the fragment highlighted.
- **Settings.** Changing the fixed chunk size from 50 to 30 words saved and
  re-chunked the notes ("38 fixed-length chunks"); an out-of-range value
  disabled Save. The Notes page then shaded 30-word windows.
- **An older workspace.** A workspace created before short tails were joined
  was opened after the change; it was re-chunked on that first request and
  used normally.
- **Phone width.** Home, Ask, Compare and Notes had no horizontal overflow, and
  all seven navigation links fitted.
- **No model key** (a second backend started without one, `next dev` pointed at
  it): the badge read "Search only"; the same question showed four sentences
  under "From your notes, word for word", including the exception, labelled as
  not generated; "Explain the Kalman filter" by keywords returned "Insufficient
  evidence"; Quiz and Flashcards were disabled and recall cards were made; the
  overview said it needs a model key.

`./check-deploy.sh http://127.0.0.1:3001 --full` passed: contract version 1 on
every reply, upload, a streamed answer, a comparison, recall cards, and the
check notes deleted afterwards.

## Live model checks

`deepseek-v4-flash` through AgentRouter, with the key in `.env.local`
(gitignored, never committed). In all, roughly 45 short requests were made
while building and checking.

### The exception survives into the answer

Recorded by `python demos/02-study-companion/record_web_runs.py`; the replies
are saved word for word in `runs/web-exception-check.json`. Each was read, and
none says or implies that negative feedback always makes a system stable.

| Chunking | Expansion | Question | Reply begins | Exception in the sections given | Among the caveats shown |
|---|---|---|---|---|---|
| section | on | Does negative feedback guarantee stability? | "No. Negative feedback does not guarantee stability [1]." | yes | yes |
| section | off | same | "No — negative feedback does not guarantee stability [1]." | yes | yes |
| fixed | on | same | "No. Negative feedback does not guarantee stability [1]." | yes | yes |
| fixed | off | same | "No. Negative feedback does not guarantee stability [1]." | yes | yes |
| fixed | on | Does it guarantee stability? (after "What is negative feedback?") | "No — negative feedback does not guarantee stability [1]." | yes | yes |

In the last row the model rewrote the follow-up to "Does negative feedback
guarantee stability?" before the notes were searched. Every citation in the
five replies pointed to a section that was in the prompt.

This is five replies from one model on one day. It shows the path works and
that these replies kept the exception; it does not show that every reply will.
The caveat box does not depend on the model, which is why it is there.

### Other replies that were read

- "Explain the Kalman filter" (keywords + meaning): the reply began with the
  configured "not found" sentence and was given the status *not found*. It went
  on to suggest two related questions, citing the sections they came from.
- A quiz of four questions on "feedback and stability": four items kept, none
  dropped. Three quotes were found in the notes word for word. The fourth
  joined two sentences and left out a word ("…and any delay. Adding gain…"
  where the notes say "…and any delay together. Adding gain…"), so it was
  flagged as not found word for word, which is the check working as intended.
- Flashcards (four) and an overview of the sample notes were written and
  parsed without error.

## The two chunkings over the same eight questions

Recorded by the same script in `runs/web-compare-keyword.json` and
`runs/web-compare-hybrid.json`, with the website's defaults: 5 matches, a
600-word budget, expansion below 60 words, 50-word windows, and
`BAAI/bge-small-en-v1.5` for meaning. "Expected in context" counts the seven
questions that have expected sections; q8 is the absent topic.

| Search | Chunking | Expected in context | Mean context words | q8, the absent topic |
|---|---|---|---|---|
| Keywords | section-aware | 7/7 | 254.8 | nothing returned |
| Keywords | fixed-length | 7/7 | 243.8 | nothing returned |
| Keywords + meaning | section-aware | 7/7 | 325.1 | 5 sections, by meaning only |
| Keywords + meaning | fixed-length | 7/7 | 281.6 | 5 sections, by meaning only |

Under these settings both chunkings brought every expected section into the
context. They differed in what else they brought: with keywords + meaning, in
six of the eight questions at least one section reached the context under one
chunking and not the other. Fixed-length used fewer context words on average.

The command-line demo's saved runs (4 matches, a 250-word budget, 40-word
windows, keywords) show 7/7 against 6/7, the difference being q4. So the
picture depends on the settings. These are observations on eight authored
questions over one small synthetic file. They do not show that either
chunking is better in general, and no winner is declared.

## Not verified

- No deployment was made, so the Space entrypoint (`hf-space/app.py`, which
  needs Gradio and the `spaces` package) and the Vercel configuration were not
  run. The assembled backend was run only with plain FastAPI.
- Scanned pages and Word files were not uploaded through this site. They go
  through the extraction code shared with Campus Guide, whose tests (run above)
  exercise real OCR and Word files.
- No large set of notes was tried; the largest upload was about 850 words.
  Timing and memory for long documents are unmeasured here.
- The GitHub Actions workflow was edited to cover this site and has not run.
- Answer quality was not measured. The checks above read a handful of replies.
