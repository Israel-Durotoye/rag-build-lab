"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  FlaskConical,
  Loader2,
  Minus,
  Play,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compare } from "@/lib/api";
import { formatMs, plural, sectionOf } from "@/lib/text";
import type {
  Chunking,
  CompareResult,
  CompareRun,
  NumericPref,
  RetrievalMode,
} from "@/lib/types";
import { errorMessage, useStudy } from "./study-provider";
import {
  BudgetMeter,
  Caveats,
  CHUNKING_LABEL,
  NoNotesYet,
  PageHead,
  SourceCard,
  Stat,
} from "./ui";

const CHUNKINGS: Chunking[] = ["section", "fixed"];
const NUMBERS: {
  field: Exclude<NumericPref, "chunkWords">;
  label: string;
  hint: string;
}[] = [
  { field: "k", label: "Matches", hint: "Chunks retrieved per question" },
  {
    field: "budgetWords",
    label: "Word budget",
    hint: "The most words the context may hold",
  },
  {
    field: "expandBelowWords",
    label: "Expand below",
    hint: "Matches smaller than this many words grow to their section",
  },
];

interface SetQuestion {
  id: string;
  label: string;
  query: string;
  category?: string;
  expected?: string[];
  expectsNothing?: boolean;
}

interface SetRow extends SetQuestion {
  result?: CompareResult;
  error?: string;
}

function Column({ run, result }: { run: CompareRun; result: CompareResult }) {
  const only =
    run.chunking === "section"
      ? result.agreement.sectionOnly
      : result.agreement.fixedOnly;
  return (
    <section className="card lab-column" data-chunking={run.chunking}>
      <header>
        <h2>{CHUNKING_LABEL[run.chunking]}</h2>
        <p className="muted">
          {run.chunking === "section"
            ? "One chunk for each section of your notes."
            : `Windows of ${run.chunkWords} words. A window never crosses a heading, and a few leftover words join the window before them.`}
        </p>
      </header>
      <div className="stats">
        <Stat label="Chunks in the index" value={run.totalChunks} />
        <Stat label="Matches retrieved" value={run.retrieved.length} />
        <Stat
          label="Grew to a section"
          value={run.expanded}
          hint="Small matches replaced by their whole parent section"
        />
        <Stat label="Sections in context" value={run.sections.length} />
      </div>
      <BudgetMeter budget={run.budget} />
      {run.weak && (
        <p className="note">
          <AlertTriangle size={14} aria-hidden /> No chunk contains the words of
          this question. These are only the nearest in meaning.
        </p>
      )}

      <h3 className="part-title">
        Retrieved <small>in rank order, before the context is built</small>
      </h3>
      {run.retrieved.length ? (
        <ol className="chunk-list">
          {run.retrieved.map((chunk) => (
            <li key={chunk.id}>
              <details>
                <summary>
                  <span className="rank">{chunk.rank}</span>
                  <span className="source-title">
                    <strong>{chunk.title}</strong>
                    <small>
                      {chunk.pieces > 1
                        ? `window ${chunk.piece} of ${chunk.pieces} · `
                        : ""}
                      {plural(chunk.words, "word")}
                      {chunk.words < chunk.sectionWords
                        ? ` of the section's ${chunk.sectionWords}`
                        : ""}
                    </small>
                  </span>
                  <ChevronDown size={15} className="chevron" aria-hidden />
                </summary>
                <p className="source-text">{chunk.text}</p>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing was retrieved.</p>
      )}

      <h3 className="part-title">
        Reached the context <small>what a model would read</small>
      </h3>
      {run.context.map((item) => (
        <div
          key={item.id}
          data-only={
            only.includes(`${item.docId}:${item.sectionId}`) || undefined
          }
          className="lab-item"
        >
          <SourceCard item={item} />
        </div>
      ))}
      {!run.context.length && <p className="muted">Nothing reached it.</p>}
      {run.budget.skipped.length > 0 && (
        <ul className="skipped">
          {run.budget.skipped.map((skip) => (
            <li key={skip.chunkId}>
              <Minus size={12} aria-hidden /> <code>{skip.chunkId}</code> left
              out: {skip.reason}
            </li>
          ))}
        </ul>
      )}
      <Caveats caveats={run.caveats} />
      <p className="fine">Took {formatMs(run.ms)}.</p>
    </section>
  );
}

function Agreement({ result }: { result: CompareResult }) {
  const groups = [
    { label: "Reached by both", keys: result.agreement.both, tone: "both" },
    {
      label: "Only section-aware",
      keys: result.agreement.sectionOnly,
      tone: "section",
    },
    {
      label: "Only fixed-length",
      keys: result.agreement.fixedOnly,
      tone: "fixed",
    },
  ];
  return (
    <section className="card agreement">
      {groups.map((group) => (
        <div key={group.label} data-tone={group.tone}>
          <h3>{group.label}</h3>
          {group.keys.length ? (
            <div className="chips">
              {group.keys.map((key) => (
                <span
                  key={key}
                  className="chip"
                  title={`${result.titles[key]?.docName} · ${result.titles[key]?.location}`}
                >
                  {result.titles[key]?.title ?? key}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">None</p>
          )}
        </div>
      ))}
      <p className="fine">{result.scope}</p>
    </section>
  );
}

function Reached({ row, chunking }: { row: SetRow; chunking: Chunking }) {
  const run = row.result?.runs[chunking];
  if (!run) return <td className="muted">—</td>;
  const found = run.sections.map(sectionOf);
  return (
    <td>
      {row.expected?.length ? (
        <ul className="expected">
          {row.expected.map((section) => (
            <li key={section} data-found={found.includes(section)}>
              {found.includes(section) ? (
                <Check size={12} strokeWidth={3} aria-label="reached" />
              ) : (
                <Minus size={12} strokeWidth={3} aria-label="not reached" />
              )}
              {section}
            </li>
          ))}
        </ul>
      ) : row.expectsNothing ? (
        <span className="muted">
          {run.context.length
            ? `${plural(run.context.length, "section")} returned${run.weak ? ", nearest in meaning only" : ""}`
            : "nothing returned"}
        </span>
      ) : (
        <span>{plural(run.sections.length, "section")}</span>
      )}
      <small>
        {run.budget.usedWords} words
        {run.expanded ? ` · ${run.expanded} expanded` : ""}
      </small>
    </td>
  );
}

function QuestionSet({
  options,
}: {
  options: {
    mode: RetrievalMode;
    expand: boolean;
    numbers: Record<Exclude<NumericPref, "chunkWords">, number>;
  };
}) {
  const { sample, openLab } = useStudy();
  const [picked, setPicked] = useState<"sample" | "own" | null>(null);
  const [own, setOwn] = useState("");
  const [rows, setRows] = useState<SetRow[]>([]);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const hasSample = !!sample?.loaded;
  // Until the student chooses, the sample set is offered when it is loaded.
  const source = picked === "own" || !hasSample ? "own" : (picked ?? "sample");

  useEffect(() => () => abort.current?.abort(), []);

  const questions: SetQuestion[] = useMemo(() => {
    if (source === "sample" && sample)
      return sample.questions.map((q) => ({
        id: q.id,
        label: q.previous ? `${q.previous} → ${q.question}` : q.question,
        query: q.previous
          ? `${q.previous}\nFollow-up: ${q.question}`
          : q.question,
        category: q.category,
        expected: q.expected_sections,
        expectsNothing: q.expected_status === "insufficient_evidence",
      }));
    return own
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((line, index) => ({
        id: `q${index + 1}`,
        label: line,
        query: line,
      }));
  }, [own, sample, source]);

  const run = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    const next: SetRow[] = questions.map((q) => ({ ...q }));
    setRows(next);
    for (const [index, question] of questions.entries()) {
      try {
        next[index] = {
          ...question,
          result: await compare(
            {
              query: question.query,
              mode: options.mode,
              expand: options.expand,
              ...options.numbers,
            },
            controller.signal,
          ),
        };
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") return;
        next[index] = {
          ...question,
          error: errorMessage(cause, "This question could not be run."),
        };
      }
      setRows([...next]);
    }
    setRunning(false);
  };

  const finished = rows.filter((row) => row.result);
  const withExpected = finished.filter((row) => row.expected?.length);
  const tally = (chunking: Chunking) => ({
    reached: withExpected.filter((row) => {
      const found = row.result!.runs[chunking].sections.map(sectionOf);
      return row.expected!.every((section) => found.includes(section));
    }).length,
    words: finished.length
      ? Math.round(
          finished.reduce(
            (sum, row) => sum + row.result!.runs[chunking].budget.usedWords,
            0,
          ) / finished.length,
        )
      : 0,
  });

  return (
    <section className="card question-set">
      <header>
        <h2>Run a set of questions</h2>
        <p className="muted">
          The same questions against both chunkings, with the options chosen
          above.
        </p>
      </header>
      <div className="row">
        {hasSample && (
          <div className="segmented" role="group" aria-label="Which questions">
            <button
              type="button"
              aria-pressed={source === "sample"}
              onClick={() => setPicked("sample")}
            >
              The sample set ({sample!.questions.length})
            </button>
            <button
              type="button"
              aria-pressed={source === "own"}
              onClick={() => setPicked("own")}
            >
              My own questions
            </button>
          </div>
        )}
        <button
          type="button"
          className="button"
          disabled={running || !questions.length}
          onClick={() => void run()}
        >
          {running ? (
            <Loader2 size={15} className="spin" aria-hidden />
          ) : (
            <Play size={15} aria-hidden />
          )}
          Run {plural(questions.length, "question")}
        </button>
      </div>
      {source === "own" && (
        <label className="field">
          <span>One question on each line, up to 20</span>
          <textarea
            rows={4}
            value={own}
            onChange={(event) => setOwn(event.target.value)}
            placeholder={
              "What is negative feedback?\nHow does integral action differ from proportional control?"
            }
          />
        </label>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="set-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Section-aware</th>
                <th scope="col">Fixed-length</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {row.label}
                    {row.category && <small>{row.category}</small>}
                    {row.error && <small className="error">{row.error}</small>}
                  </th>
                  {row.result || row.error ? (
                    <>
                      <Reached row={row} chunking="section" />
                      <Reached row={row} chunking="fixed" />
                    </>
                  ) : (
                    <td colSpan={2} className="muted">
                      <Loader2 size={13} className="spin" aria-hidden /> waiting
                    </td>
                  )}
                  <td>
                    {row.result && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          openLab(row.query, row.result!);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {finished.length > 0 && !running && (
              <tfoot>
                <tr>
                  <th scope="row">
                    Across {plural(finished.length, "question")}
                  </th>
                  {CHUNKINGS.map((chunking) => {
                    const { reached, words } = tally(chunking);
                    return (
                      <td key={chunking}>
                        {withExpected.length > 0 && (
                          <span>
                            Expected sections all reached in {reached} of{" "}
                            {withExpected.length}
                          </span>
                        )}
                        <small>{words} context words on average</small>
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="fine">
        These are observations on the questions you ran, over your notes, with
        these settings. They do not show that either chunking is better in
        general, and no winner is declared.
      </p>
    </section>
  );
}

type Numbers = Record<Exclude<NumericPref, "chunkWords">, number>;

/** The question box. Remounted (by key) whenever the lab's question changes. */
function QuestionForm({
  initial,
  disabled,
  onRun,
  children,
}: {
  initial: string;
  disabled: boolean;
  onRun: (question: string) => void;
  children: ReactNode;
}) {
  const { lab } = useStudy();
  const [question, setQuestion] = useState(initial);
  return (
    <form
      className="card lab-form"
      onSubmit={(event) => {
        event.preventDefault();
        onRun(question);
      }}
    >
      <label className="field">
        <span>Question</span>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="How does proportional control differ from integral action?"
          maxLength={4000}
        />
      </label>
      {children}
      <div className="row">
        <button
          type="submit"
          className="button"
          disabled={lab.running || !question.trim() || disabled}
        >
          {lab.running ? (
            <Loader2 size={15} className="spin" aria-hidden />
          ) : (
            <FlaskConical size={15} aria-hidden />
          )}
          Compare
        </button>
        {lab.error && <p className="error">{lab.error}</p>}
      </div>
    </form>
  );
}

export function CompareView() {
  const { health, documents, settings, mode, setMode, lab, runLab } =
    useStudy();
  const [expand, setExpand] = useState(true);
  const [numbers, setNumbers] = useState<Numbers | null>(null);

  const stored = settings?.settings;
  const chosen: Numbers | null = useMemo(
    () =>
      numbers ??
      (stored
        ? {
            k: stored.k,
            budgetWords: stored.budgetWords,
            expandBelowWords: stored.expandBelowWords,
          }
        : null),
    [numbers, stored],
  );

  if (documents && !documents.length)
    return (
      <NoNotesYet what="The chunking lab runs one question against two ways of cutting your notes." />
    );

  const ranges = settings?.ranges;
  const valid =
    !!chosen &&
    !!ranges &&
    NUMBERS.every(({ field }) => {
      const value = chosen[field];
      return (
        Number.isInteger(value) &&
        value >= ranges[field][0] &&
        value <= ranges[field][1]
      );
    });
  const result = lab.result;
  const semantic = health?.embeddings.status !== "off";

  return (
    <div className="lab">
      <PageHead
        eyebrow="Chunking lab"
        title={
          <>
            One question, <em>two ways of cutting your notes</em>
          </>
        }
      >
        Before anything can be searched, notes are cut into chunks. Cut by
        section and each chunk is a whole idea. Cut by length and each chunk is
        the same size, but may start or stop mid-thought. See what each one
        finds, and what reaches the model. No model is used on this page.
      </PageHead>

      <QuestionForm
        key={lab.question}
        initial={lab.question}
        disabled={!valid || !health}
        onRun={(question) =>
          void runLab(question, { expand, numbers: chosen ?? undefined })
        }
      >
        <div className="lab-options">
          <label className="field">
            <span>Search by</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as RetrievalMode)}
            >
              <option value="hybrid" disabled={!semantic}>
                Keywords + meaning
              </option>
              <option value="keyword">Keywords only</option>
              <option value="semantic" disabled={!semantic}>
                Meaning only
              </option>
            </select>
          </label>
          {NUMBERS.map(({ field, label, hint }) => (
            <label key={field} className="field" title={hint}>
              <span>{label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={ranges?.[field][0]}
                max={ranges?.[field][1]}
                value={
                  chosen && !Number.isNaN(chosen[field]) ? chosen[field] : ""
                }
                onChange={(event) =>
                  chosen &&
                  setNumbers({
                    ...chosen,
                    [field]: event.target.valueAsNumber,
                  })
                }
              />
            </label>
          ))}
          <div className="field">
            <span>Fixed chunk size</span>
            <Link
              href="/settings"
              className="readout"
              title="Changing it re-indexes your notes"
            >
              {stored ? `${stored.chunkWords} words` : "—"}
            </Link>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={expand}
              onChange={(event) => setExpand(event.target.checked)}
            />
            <span>Expand small matches to their section</span>
          </label>
        </div>
        {!valid && chosen && ranges && (
          <p className="error">
            Matches {ranges.k.join("–")}, word budget{" "}
            {ranges.budgetWords.join("–")}, expand below{" "}
            {ranges.expandBelowWords.join("–")}.
          </p>
        )}
      </QuestionForm>

      {lab.running && !result && (
        <p className="muted" role="status">
          <Loader2 size={14} className="spin" aria-hidden /> Searching both
          chunkings…
        </p>
      )}

      {result && (
        <>
          <p className="lab-query">
            Searched for <q>{result.query.replace(/\n/g, " · ")}</q> ·{" "}
            {result.runs.section.mode === result.requestedMode
              ? result.requestedMode
              : `${result.runs.section.mode} (semantic search is unavailable)`}{" "}
            search · expansion {result.expand ? "on" : "off"}
          </p>
          <Agreement result={result} />
          <div className="lab-columns">
            {CHUNKINGS.map((chunking) => (
              <Column
                key={chunking}
                run={result.runs[chunking]}
                result={result}
              />
            ))}
          </div>
        </>
      )}

      {chosen && valid && (
        <QuestionSet options={{ mode, expand, numbers: chosen }} />
      )}
    </div>
  );
}
