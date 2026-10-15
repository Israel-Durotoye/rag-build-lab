"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  LoaderCircle,
  ScanEye,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { memo, useState, type ReactNode } from "react";
import { arithmetic } from "@/lib/rrf";
import { formatMs, plural } from "@/lib/text";
import type {
  AnswerStatus,
  ChunkInfo,
  Clarification,
  ClarifyReason,
  ContextItem,
  ContextTrace,
  ContextUnit,
  Excluded,
  FaultCard,
  FilterInfo,
  IdentifyTrace,
  LibraryModel,
  ModelRef,
  RetrievalMode,
  RetrievalTrace,
  Rewrite,
  Stage,
  Turn,
} from "@/lib/types";
import { CodeDisplay } from "./code-display";
import { useFinder } from "./finder-provider";
import { Markdown } from "./markdown";
import { Alert, ModelChip, ModelTags, PageHead, PassageText } from "./ui";
import styles from "./inspect-view.module.css";

/**
 * Inspect: one question, step by step, exactly as the backend reported it.
 * Every number, list and passage on this page comes from the turn's events
 * (identify → retrieval → context → done); nothing is estimated here.
 */

type ModelLookup = (id: string | null | undefined) => LibraryModel | undefined;
type StepKey = "identify" | "filter" | "retrieve" | "context" | "generate";
type StepState = "done" | "active" | "waiting" | "skipped" | "stopped";

interface StepInfo {
  key: StepKey;
  n: number;
  label: string;
  stage: Stage;
  about: string;
}

const STEPS: StepInfo[] = [
  {
    key: "identify",
    n: 1,
    label: "Identify",
    stage: "identify",
    about:
      "Reads the question for codes and model names, then decides which model to answer for, or asks.",
  },
  {
    key: "filter",
    n: 2,
    label: "Filter",
    stage: "retrieval",
    about:
      "Keeps only the passages that apply to that model, before anything is ranked.",
  },
  {
    key: "retrieve",
    n: 3,
    label: "Retrieve",
    stage: "retrieval",
    about:
      "Ranks the allowed passages by keywords, by meaning or both, and keeps the top ones.",
  },
  {
    key: "context",
    n: 4,
    label: "Context",
    stage: "context",
    about:
      "Grows each kept passage into its section as this model sees it, within the word budget.",
  },
  {
    key: "generate",
    n: 5,
    label: "Generate",
    stage: "generation",
    about:
      "A model writes the answer from the numbered passages, then every citation is checked.",
  },
];

const STATE_TEXT: Record<StepState, string> = {
  done: "Done",
  active: "Running",
  waiting: "Waiting",
  skipped: "Not run",
  stopped: "Stopped",
};

const STATUS: Record<
  AnswerStatus,
  { label: string; tone: "" | "warn" | "bad"; text: string }
> = {
  answered: {
    label: "Answered",
    tone: "",
    text: "Answered from the passages, with checked citations.",
  },
  uncited: {
    label: "No valid citation",
    tone: "warn",
    text: "Answered, but without a valid citation: check it against the passages.",
  },
  not_found: {
    label: "Not covered",
    tone: "warn",
    text: "The model found no answer in the passages and said so.",
  },
  interrupted: {
    label: "Interrupted",
    tone: "warn",
    text: "The answer stopped partway through.",
  },
  unavailable: {
    label: "Model unavailable",
    tone: "bad",
    text: "The model couldn't be reached, so the manual's own sentences were shown.",
  },
  sources_only: {
    label: "Search only",
    tone: "warn",
    text: "No model key is configured, so the manual's own sentences were shown.",
  },
  no_passages: {
    label: "Nothing matched",
    tone: "warn",
    text: "Nothing in this model's manual matched, so no model was asked.",
  },
  clarification: {
    label: "Asked first",
    tone: "",
    text: "Finder asked before answering.",
  },
};

const MODE_LABEL: Record<RetrievalMode, string> = {
  hybrid: "Hybrid",
  keyword: "Keyword",
  semantic: "Semantic",
};

const SCHEME_LABEL: Record<string, string> = {
  flash: "LED flash pattern",
  gpio: "GPIO pin",
  hex: "Hex value",
  exit: "Exit status",
  filter: "Config filter",
  prefixed: "Error code",
  token: "Code",
};

const MENTION_LABEL: Record<string, string> = {
  model: "Model",
  family: "Family: stands for each of its models",
  revision: "Revision",
  outside: "A product outside this library",
};

const REASON_TEXT: Record<ClarifyReason, string> = {
  no_model:
    "No model was named and none was chosen in “Working on”. Finder never guesses which model.",
  ambiguous_name: "The name in the question fits more than one model.",
  conflict:
    "The question names a different model from the one in “Working on”.",
  revision: "The model's revisions differ here.",
};

/** What a candidate's mark means; a conflict offers its two models unmarked. */
const MARK: Partial<Record<ClarifyReason, { label: string; hint: string }>> = {
  no_model: {
    label: "matches",
    hint: "Models marked “matches” have passages that match the question.",
  },
  ambiguous_name: {
    label: "matches",
    hint: "Models marked “matches” have passages that match the question.",
  },
  revision: {
    label: "found",
    hint: "Revisions marked “found” have lines of their own among the passages Finder compared.",
  },
};

/** Where in the pipeline a revision question came from. */
function revisionWhen(turn: Turn): string {
  return turn.retrieval
    ? "The passages found in step 3 hold different lines for different revisions, so Finder asked before building the context."
    : "The code in the question means different things on different revisions, so Finder asked before searching.";
}

const TIE_RULE: Record<string, string> = {
  "best-rank":
    "the passage with the better best single rank goes first, then the smaller passage ID",
  id: "the smaller passage ID goes first",
};

// ---------------------------------------------------------------- helpers

function revisionLabel(
  modelById: ModelLookup,
  model: string | null,
  revision: string | null,
): string | null {
  if (!revision) return null;
  return (
    modelById(model)?.revisions.find((r) => r.id === revision)?.label ??
    revision
  );
}

function modelRef(modelById: ModelLookup, id: string): ModelRef {
  const model = modelById(id);
  return model
    ? { id: model.id, name: model.name, short: model.short }
    : { id, name: id, short: id };
}

function count(value: number): string {
  return value.toLocaleString("en");
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A passage's own words, without its table's header line. */
function excerpt(chunk: ChunkInfo): string {
  const lines = chunk.text.split("\n").filter((line) => line.trim());
  const body =
    chunk.kind === "row" &&
    chunk.header &&
    lines.length > 1 &&
    lines[0].trim() === chunk.header.trim()
      ? lines.slice(1)
      : lines;
  return body.join(" ").replace(/\s+/g, " ").trim();
}

/** Table cells of one stored row line ("a | b | c"); empty cells survive. */
function cells(line: string): string[] {
  return ` ${line} `.split(" | ").map((cell) => cell.trim());
}

function clarifyWhat(clarification: Clarification | null): string {
  return clarification?.reason === "revision"
    ? "which revision"
    : "which model";
}

function stepStates(turn: Turn): Record<StepKey, StepState> {
  const present: Record<StepKey, boolean> = {
    identify: Boolean(turn.identify),
    filter: Boolean(turn.retrieval),
    retrieve: Boolean(turn.retrieval),
    context: Boolean(turn.context),
    generate: Boolean(turn.done?.generation?.attempts.length),
  };
  // A turn that ended without its final event stopped at its first missing step.
  const stoppedAt =
    !turn.streaming && !turn.done
      ? (STEPS.find((step) => !present[step.key])?.stage ?? null)
      : null;
  const states = {} as Record<StepKey, StepState>;
  for (const step of STEPS) {
    states[step.key] = present[step.key]
      ? "done"
      : turn.streaming
        ? turn.stage === step.stage
          ? "active"
          : "waiting"
        : step.stage === stoppedAt
          ? "stopped"
          : "skipped";
  }
  return states;
}

/** Why a step has nothing to show once the question has ended. */
function notRun(turn: Turn, state: StepState): string {
  if (turn.clarification)
    return `Finder stopped to ask ${clarifyWhat(turn.clarification)}, so this step did not run.`;
  const when = state === "stopped" ? "during" : "before";
  if (turn.error === "Stopped.")
    return `The question was stopped ${when} this step.`;
  if (turn.error) return `The question ended ${when} this step: ${turn.error}`;
  return "This step did not run for this question.";
}

function turnStatus(turn: Turn): { label: string; tone: string } {
  if (turn.streaming) return { label: "In progress", tone: "" };
  if (turn.done?.status === "clarification")
    return { label: `Asked ${clarifyWhat(turn.done.clarification)}`, tone: "" };
  if (turn.done) {
    const status = STATUS[turn.done.status];
    return { label: status.label, tone: status.tone };
  }
  if (turn.error === "Stopped.") return { label: "Stopped", tone: "warn" };
  return { label: "Failed", tone: "bad" };
}

function turnModel(turn: Turn, modelById: ModelLookup): string {
  if (turn.done?.model) return turn.done.model.short;
  const id = turn.identify?.chosen.model ?? turn.selection.model;
  return id ? (modelById(id)?.short ?? id) : "No model";
}

/** Open a context item in step 4 and bring it into view. */
function showItem(n: number) {
  const item = document.getElementById(`context-item-${n}`);
  if (!item) return;
  if (item instanceof HTMLDetailsElement) item.open = true;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  item.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  item.querySelector("summary")?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- small parts

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

/** Long result lists start with their first rows; the rest are a click away. */
function Limited<T>({
  rows,
  limit = 10,
  noun,
  children,
}: {
  rows: T[];
  limit?: number;
  noun: string;
  children: (shown: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <>
      {children(shown)}
      {rows.length > limit && (
        <button
          type="button"
          className={`btn quiet small ${styles.more}`}
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          <ChevronDown size={15} className={styles.moreIcon} aria-hidden />
          {all ? `Show the first ${limit}` : `Show all ${rows.length} ${noun}`}
        </button>
      )}
    </>
  );
}

/** A passage in a ranking: its section, its own words, where it is. */
function PassageName({ id, chunk }: { id: string; chunk?: ChunkInfo }) {
  if (!chunk) return <span className={`mono small ${styles.where}`}>{id}</span>;
  const words = excerpt(chunk);
  return (
    <span className={styles.passage}>
      <strong>{chunk.title}</strong>
      {words && (
        <span className={styles.excerpt} title={words}>
          {words}
        </span>
      )}
      <span className={styles.where}>
        {chunk.docName} · {chunk.location}
      </span>
    </span>
  );
}

function Step({
  step,
  state,
  ms,
  children,
}: {
  step: StepInfo;
  state: StepState;
  ms?: number | null;
  children: ReactNode;
}) {
  return (
    <section
      id={`step-${step.key}`}
      className={`panel ${styles.step}`}
      aria-labelledby={`step-${step.key}-title`}
    >
      <header className={styles.stepHead}>
        <span className={styles.stepNo} data-state={state} aria-hidden>
          {step.n}
        </span>
        <div className={styles.stepHeading}>
          <h2 id={`step-${step.key}-title`}>
            <span className="sr-only">Step {step.n}: </span>
            {step.label}
            <span className="sr-only"> ({STATE_TEXT[state]})</span>
          </h2>
          <p className="muted small">{step.about}</p>
        </div>
        {ms != null && (
          <span className={styles.stepTime} title="Time this step took">
            {formatMs(ms)}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Pending({ state, turn }: { state: StepState; turn: Turn }) {
  if (state === "active")
    return (
      <p className={styles.note}>
        <LoaderCircle size={15} className="spin" aria-hidden /> Working on this
        step…
      </p>
    );
  if (state === "waiting")
    return <p className={styles.note}>Waiting for the earlier steps.</p>;
  return <p className={styles.note}>{notRun(turn, state)}</p>;
}

// ---------------------------------------------------------------- picker, rail

interface Entry {
  turn: Turn;
  where: "Search" | "Chat";
}

function RecentTurns({
  entries,
  current,
  onPick,
  modelById,
}: {
  entries: Entry[];
  current: string;
  onPick: (id: string) => void;
  modelById: ModelLookup;
}) {
  return (
    <section className={styles.recent} aria-labelledby="inspect-recent">
      <h2 id="inspect-recent" className="eyebrow">
        Recent questions · newest first
      </h2>
      <ul className={styles.turns}>
        {entries.map(({ turn, where }) => {
          const chosen = turn.id === current;
          const status = turnStatus(turn);
          return (
            <li key={turn.id}>
              <button
                type="button"
                className={styles.turn}
                aria-pressed={chosen}
                onClick={() => onPick(turn.id)}
              >
                <span className={styles.turnMeta}>
                  <span>
                    {where} · {clock(turn.startedAt)}
                  </span>
                  {chosen && <span className={styles.showing}>Showing</span>}
                </span>
                <span className={styles.turnQuestion}>{turn.question}</span>
                <span className={styles.turnFoot}>
                  <span className="mono">{turnModel(turn, modelById)}</span>
                  <span aria-hidden>·</span>
                  <span>{status.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StepRail({ states }: { states: Record<StepKey, StepState> }) {
  return (
    <nav className={styles.rail} aria-label="Steps">
      <ol>
        {STEPS.map((step) => (
          <li key={step.key}>
            <a
              href={`#step-${step.key}`}
              className={styles.railLink}
              aria-current={states[step.key] === "active" ? "step" : undefined}
            >
              <span
                className={styles.stepNo}
                data-state={states[step.key]}
                aria-hidden
              >
                {step.n}
              </span>
              <span className={styles.railLabel}>{step.label}</span>
              <span className={styles.railState}>
                <span className="sr-only">: </span>
                {STATE_TEXT[states[step.key]]}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------- 1 identify

function CardLine({ card }: { card: FaultCard }) {
  if (card.kind === "found")
    return (
      <p className={styles.cardLine}>
        <Check size={16} aria-hidden />
        <span>
          <strong>{card.display}</strong> is in the {card.model.name}&rsquo;s
          code tables ({card.docName}, {card.location}). That passage is placed
          first in the context (step 4) by lookup, not by ranking.
          {card.differsIn.length > 0 &&
            ` It means something else for ${card.differsIn.map((m) => m.short).join(", ")}.`}
        </span>
      </p>
    );
  return (
    <p className={styles.cardLine} data-missing>
      <X size={16} aria-hidden />
      <span>
        <strong>{card.display}</strong> isn&rsquo;t in the {card.model.name}{" "}
        manual.
        {card.didYouMean.length > 0 &&
          ` Close codes in it: ${card.didYouMean.map((c) => c.display).join(", ")}.`}
        {card.elsewhere.length > 0 &&
          ` It is in the manuals for ${card.elsewhere.map((m) => m.short).join(", ")}.`}
      </span>
    </p>
  );
}

function whyChosen(
  trace: IdentifyTrace,
  clarification: Clarification | null,
): string {
  const { chosen, picker, mentions } = trace;
  if (chosen.source === "picker")
    return "The question names no model, so the one chosen in “Working on” was used.";
  if (chosen.source === "question") {
    const named = mentions.some(
      (m) => chosen.model !== null && m.models.includes(chosen.model),
    );
    if (!named)
      return "Kept from an earlier question in this conversation, which named it.";
    return picker.model
      ? "The question names it, and it is the model in “Working on”."
      : "The question names it. Nothing was chosen in “Working on”.";
  }
  if (clarification)
    return `No model was used yet: Finder asked ${clarifyWhat(clarification)} instead (below).`;
  return "The library has no models, so no model filter was applied.";
}

function IdentifyStep({
  turn,
  trace,
  modelById,
}: {
  turn: Turn;
  trace: IdentifyTrace;
  modelById: ModelLookup;
}) {
  const rewrite: Rewrite | undefined = trace.rewrite;
  const clarification = turn.clarification;
  const pickerModel = modelById(trace.picker.model);
  const chosenModel = modelById(trace.chosen.model);
  const pickerRevision = revisionLabel(
    modelById,
    trace.picker.model,
    trace.picker.revision,
  );
  const chosenRevision = revisionLabel(
    modelById,
    trace.chosen.model,
    trace.chosen.revision,
  );
  const rewritten = trace.query !== trace.question;
  const mark = clarification ? MARK[clarification.reason] : undefined;

  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Question</dt>
          <dd className={styles.question}>{trace.question}</dd>
        </div>
        <div>
          <dt>Searched for</dt>
          <dd>
            <code className={styles.query}>{trace.query}</code>
            {!rewritten && <p className="hint">Searched as written.</p>}
            {trace.readAs.length > 0 && (
              <p className={styles.readAs}>
                <span className="hint">
                  Codes are searched the way the manuals write them:
                </span>
                {trace.readAs.map((read) => (
                  <span key={read} className="chip tiny accent">
                    Read as {read}
                  </span>
                ))}
              </p>
            )}
          </dd>
        </div>
        {rewrite?.followUp && (
          <div>
            <dt>Follow-up</dt>
            <dd>
              <p>
                {rewrite.method === "model"
                  ? `Read as a follow-up. ${rewrite.model ?? "The model"} rewrote it as a question that stands on its own (${formatMs(rewrite.ms)}).`
                  : `Read as a follow-up: the conversation's first question was joined to it, without a model${rewrite.error ? ` (the model could not rewrite it: ${rewrite.error})` : ""}.`}
              </p>
              {rewrite.carried.length > 0 && (
                <ul className={styles.carried}>
                  {rewrite.carried.map((question, index) => (
                    <li key={`${index}-${question}`}>“{question}”</li>
                  ))}
                </ul>
              )}
              <p className="hint">{rewrite.note}</p>
            </dd>
          </div>
        )}
        {rewrite && !rewrite.followUp && rewrite.detected && (
          <div>
            <dt>Follow-up</dt>
            <dd className="small">
              It looked like a follow-up, but it was asked as a new question, so
              it was searched on its own.
            </dd>
          </div>
        )}
      </dl>

      <div className={styles.block}>
        <h3>Codes found</h3>
        {trace.codes.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">As written</th>
                  <th scope="col">Read as</th>
                  <th scope="col">Kind</th>
                  <th scope="col">In this library</th>
                </tr>
              </thead>
              <tbody>
                {trace.codes.map((code) => (
                  <tr key={`${code.start}-${code.code}`}>
                    <td className="mono">{code.raw}</td>
                    <td>
                      <CodeDisplay
                        code={code.code}
                        display={code.display}
                        scheme={code.scheme}
                        size="small"
                        missing={!code.known}
                      />
                    </td>
                    <td>{SCHEME_LABEL[code.scheme] ?? code.scheme}</td>
                    <td>
                      {code.known ? (
                        <span className="chip tiny accent">
                          <Check size={12} aria-hidden /> Known
                        </span>
                      ) : (
                        <span className="chip tiny warn">
                          Not in any manual
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>
            No code, pin, port or LED pattern was found in the question.
          </p>
        )}
        {turn.card && <CardLine card={turn.card} />}
      </div>

      <div className={styles.block}>
        <h3>Model names found</h3>
        {trace.mentions.length ? (
          <ul className={styles.mentions}>
            {trace.mentions.map((mention) => (
              <li key={`${mention.start}-${mention.alias}`}>
                <span className={styles.asWritten}>
                  “
                  {trace.question.slice(mention.start, mention.end) ||
                    mention.alias}
                  ”
                </span>
                <span className={styles.kind}>
                  {MENTION_LABEL[mention.kind] ?? mention.kind}
                </span>
                {mention.models.length > 0 && (
                  <span className="tag-row">
                    {mention.models.map((id) => (
                      <ModelChip key={id} model={modelRef(modelById, id)} />
                    ))}
                  </span>
                )}
                {mention.revision && (
                  <span className="chip tiny flat">
                    {revisionLabel(
                      modelById,
                      mention.models[0] ?? null,
                      mention.revision,
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>The question names no model.</p>
        )}
      </div>

      <div className={styles.block}>
        <h3>Which model</h3>
        <div className={styles.decision}>
          <div className={`well ${styles.choice}`}>
            <span className="eyebrow">Working on</span>
            <strong>
              {pickerModel?.name ?? trace.picker.model ?? "Nothing chosen"}
            </strong>
            {pickerRevision && (
              <span className="small muted">Revision {pickerRevision}</span>
            )}
          </div>
          <ArrowRight className={styles.decisionArrow} size={20} aria-hidden />
          <div className={`well ${styles.choice}`}>
            <span className="eyebrow">Model used</span>
            <strong>
              {chosenModel?.name ??
                trace.chosen.model ??
                (clarification ? "None yet: Finder asked" : "No model")}
            </strong>
            {chosenRevision ? (
              <span className="small muted">Revision {chosenRevision}</span>
            ) : chosenModel?.revisions.length ? (
              <span className="small muted">
                No revision chosen: every revision&rsquo;s passages allowed
              </span>
            ) : null}
          </div>
        </div>
        <p className="small">{whyChosen(trace, clarification)}</p>
      </div>

      {clarification && (
        <div className={styles.clarify}>
          <h3>Finder asked</h3>
          <p>{clarification.message}</p>
          <p className="small muted">
            {REASON_TEXT[clarification.reason]}
            {clarification.reason === "revision" && ` ${revisionWhen(turn)}`}
          </p>
          <ul className={styles.candidates} aria-label="The choices offered">
            {clarification.candidates.map((candidate) => {
              const marked = candidate.matched && mark;
              return (
                <li key={`${candidate.kind}-${candidate.id}`}>
                  <span
                    className={`chip tiny ${marked ? "accent" : "flat"}`}
                    title={candidate.name}
                  >
                    {candidate.kind === "model"
                      ? candidate.short
                      : candidate.name}
                    {marked && (
                      <span className={styles.matchedNote}>
                        · {marked.label}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">
            {mark ? `${mark.hint} ` : ""}Only the choices are shown, never what
            each manual says.
          </p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 2 filter

function FilterStep({
  filter,
  excluded,
  modelById,
  cap,
}: {
  filter: FilterInfo;
  excluded: Excluded | null;
  modelById: ModelLookup;
  cap: number;
}) {
  const model = modelById(filter.model);
  const name = model?.short ?? filter.model;
  const revision = revisionLabel(modelById, filter.model, filter.revision);
  const total = filter.allowed + filter.excluded;
  const share = total ? Math.max(1, (filter.allowed / total) * 100) : 100;

  if (!filter.model)
    return (
      <p>
        No model was chosen, so nothing was filtered: all{" "}
        {plural(filter.allowed, "passage")} could be ranked.
      </p>
    );

  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Model</dt>
          <dd className={styles.inline}>
            {model?.name ?? filter.model}
            {model && <ModelChip model={model} />}
          </dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>
            {revision ??
              (model?.revisions.length
                ? "Any: passages for every revision were allowed"
                : "None listed for this model")}
          </dd>
        </div>
      </dl>

      <div className={styles.block}>
        <div className={styles.split} aria-hidden>
          <span
            className={styles.splitAllowed}
            style={{ width: `${share}%` }}
          />
          {filter.excluded > 0 && <span className={styles.splitExcluded} />}
        </div>
        <ul className={styles.legend}>
          <li>
            <span
              className={`${styles.key} ${styles.keyAllowed}`}
              aria-hidden
            />
            <span>
              <strong>{count(filter.allowed)}</strong> allowed: passages that
              apply to the {name}, including those its manuals share across
              models
            </span>
          </li>
          <li>
            <span
              className={`${styles.key} ${styles.keyExcluded}`}
              aria-hidden
            />
            <span>
              <strong>{count(filter.excluded)}</strong> excluded: passages for
              other models{revision ? " or other revisions" : ""}
            </span>
          </li>
        </ul>
        <p>
          The filter is applied before ranking, so excluded passages never take
          a rank: none of them can push a {name} passage down the list, and none
          reaches the model that writes the answer.
        </p>
      </div>

      {excluded && excluded.count > 0 ? (
        <details className={styles.disclosure}>
          <summary>
            <ChevronDown size={16} className={styles.chevron} aria-hidden />
            <span className={styles.summaryText}>
              <span>
                {excluded.count >= cap
                  ? `At least ${excluded.count}`
                  : count(excluded.count)}{" "}
                excluded passages also matched the question
              </span>
              <small>
                the best {excluded.items.length} shown greyed; never ranked
                here, never sent
              </small>
            </span>
          </summary>
          <ol className={styles.excludedList}>
            {excluded.items.map((item) => (
              <li key={item.id} className="unit masked">
                <div className={styles.unitMeta}>
                  <span className="mono">#{item.rank}</span>
                  <strong className={styles.excludedTitle}>{item.title}</strong>
                  <span>
                    {item.docName} · {item.location}
                  </span>
                  <span className="tag-row">
                    {item.models.map((m) => (
                      <ModelChip key={m.id} model={m} other />
                    ))}
                  </span>
                </div>
                <p className="unit-text passage-text">
                  {item.text.split("\n").map((line, index) => (
                    <span key={index} className="passage-line">
                      {line}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        filter.excluded > 0 && (
          <p className={styles.note}>
            No passage from another model matched the question.
          </p>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------- 3 retrieve

const RetrieveStep = memo(function RetrieveStep({
  trace,
}: {
  trace: RetrievalTrace;
}) {
  const selected = new Set(trace.selected);
  const fellBack = trace.mode !== trace.requestedMode;
  const hybrid = trace.mode === "hybrid";
  const { constant, tieBreak } = trace.fused;
  const rowClass = (id: string) =>
    selected.has(id) ? styles.selectedRow : undefined;

  return (
    <>
      <dl className={styles.stats}>
        <Stat
          label="Search"
          value={MODE_LABEL[trace.mode]}
          hint={
            fellBack
              ? `${MODE_LABEL[trace.requestedMode]} was asked for`
              : undefined
          }
        />
        <Stat
          label="Passages searched"
          value={count(trace.totalChunks)}
          hint="after the filter"
        />
        <Stat
          label="Kept"
          value={`${trace.selected.length} of ${trace.k}`}
          hint={`from up to ${trace.candidates} per list`}
        />
      </dl>

      {fellBack && (
        <Alert tone="warn">
          {MODE_LABEL[trace.requestedMode]} search was asked for, but only
          keyword search ran.{" "}
          {trace.semantic.reason ?? "Semantic search wasn't available."}
        </Alert>
      )}
      {trace.weak && (
        <Alert tone="warn">
          No passage contains a word of the question. What was kept is only the
          nearest in meaning, and may be unrelated.
        </Alert>
      )}

      <p className={styles.note}>
        Highlighted rows are the top {trace.k} kept for the context (step 4).
      </p>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h3>Keyword search (BM25)</h3>
          <span className={styles.ms}>{formatMs(trace.keyword.ms)}</span>
        </div>
        <p className={styles.note}>
          Words searched, after common words are dropped. Word endings are
          ignored, so “select” also matches “selects”. BM25 scores rarer words
          and shorter passages higher.
        </p>
        {trace.keyword.terms.length > 0 && (
          <ul className="tag-row" aria-label="Words searched">
            {trace.keyword.terms.map((term) => (
              <li key={term} className="chip tiny flat mono">
                {term}
              </li>
            ))}
          </ul>
        )}
        {trace.keyword.results.length ? (
          <Limited rows={trace.keyword.results} noun="keyword results">
            {(rows) => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Passage</th>
                      <th scope="col">BM25</th>
                      <th scope="col">Matched words</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={rowClass(row.id)}>
                        <td>
                          <span className="rank">{row.rank}</span>
                        </td>
                        <td>
                          <PassageName
                            id={row.id}
                            chunk={trace.chunks[row.id]}
                          />
                        </td>
                        <td className={styles.num}>{row.score.toFixed(2)}</td>
                        <td>
                          <span className="tag-row">
                            {row.terms.map((term) => (
                              <span key={term} className="chip tiny flat mono">
                                {term}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Limited>
        ) : (
          <p className={styles.note}>
            No allowed passage contains any of these words.
          </p>
        )}
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h3>Semantic search</h3>
          {trace.semantic.available && (
            <span className={styles.ms}>{formatMs(trace.semantic.ms)}</span>
          )}
        </div>
        {trace.semantic.available ? (
          <>
            <p className={styles.note}>
              {trace.semantic.model ?? "The embedding model"} turned the
              question into{" "}
              {trace.semantic.dimensions
                ? `${trace.semantic.dimensions} numbers`
                : "numbers"}{" "}
              and compared them with every allowed passage. A similarity of
              1.000 would mean the same meaning.
            </p>
            {trace.semantic.results.length ? (
              <Limited rows={trace.semantic.results} noun="semantic results">
                {(rows) => (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Rank</th>
                          <th scope="col">Passage</th>
                          <th scope="col">Similarity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className={rowClass(row.id)}>
                            <td>
                              <span className="rank">{row.rank}</span>
                            </td>
                            <td>
                              <PassageName
                                id={row.id}
                                chunk={trace.chunks[row.id]}
                              />
                            </td>
                            <td className={styles.num}>
                              {row.similarity.toFixed(3)}
                              <span className={styles.bar} aria-hidden>
                                <i
                                  style={{
                                    width: `${Math.max(0, Math.min(1, row.similarity)) * 100}%`,
                                  }}
                                />
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Limited>
            ) : (
              <p className={styles.note}>
                No allowed passage has an embedding.
              </p>
            )}
          </>
        ) : (
          <p className={styles.note}>
            {trace.requestedMode === "keyword"
              ? "Not used: keyword search was chosen for this question."
              : `Not used. ${trace.semantic.reason ?? "Semantic search wasn't available."}`}
          </p>
        )}
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h3>
            {hybrid ? "Fused ranking (reciprocal rank fusion)" : "Final order"}
          </h3>
        </div>
        {hybrid ? (
          <div className={`well ${styles.rule}`}>
            <p>
              Each passage scores 1 / ({constant} + rank) for every list it is
              in, and the scores are added. Only ranks are combined, because a
              BM25 score and a similarity are on different scales.
            </p>
            <p className="small">
              <strong>Constant:</strong> {constant} · <strong>Ties:</strong>{" "}
              {TIE_RULE[tieBreak] ?? tieBreak}. Scores are compared exactly, so
              “tied” means truly equal.
            </p>
          </div>
        ) : (
          <p className={styles.note}>
            Only {trace.mode} search ran, so its ranking is the final order.
            Nothing was fused.
          </p>
        )}
        {trace.fused.results.length ? (
          <Limited rows={trace.fused.results} noun="passages">
            {(rows) => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Passage</th>
                      {hybrid && <th scope="col">Score</th>}
                      <th scope="col">Keyword rank</th>
                      <th scope="col">Semantic rank</th>
                      {hybrid && <th scope="col">Tie</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={rowClass(row.id)}>
                        <td>
                          <span className="rank">{row.rank}</span>
                        </td>
                        <td>
                          <PassageName
                            id={row.id}
                            chunk={trace.chunks[row.id]}
                          />
                          {selected.has(row.id) && (
                            <span className={`chip tiny accent ${styles.kept}`}>
                              <Check size={12} aria-hidden /> Kept
                            </span>
                          )}
                        </td>
                        {hybrid && (
                          <td className={styles.num}>
                            {row.score.toFixed(5)}
                            <span className={styles.arith}>
                              {arithmetic(
                                [row.keywordRank, row.semanticRank],
                                constant,
                              )}
                            </span>
                          </td>
                        )}
                        <td className={styles.num}>{row.keywordRank ?? "—"}</td>
                        <td className={styles.num}>
                          {row.semanticRank ?? "—"}
                        </td>
                        {hybrid && (
                          <td>
                            {row.tied ? (
                              <span
                                className="chip tiny warn"
                                title="Its score equals another passage's exactly; the tie rule set the order"
                              >
                                Tied
                              </span>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Limited>
        ) : (
          <p className={styles.note}>Nothing matched, so nothing was kept.</p>
        )}
      </div>
    </>
  );
});

// ---------------------------------------------------------------- 4 context

type Group =
  | { kind: "table"; header: string; units: ContextUnit[] }
  | { kind: "unit"; unit: ContextUnit };

/** Consecutive rows of one table are drawn as one table. */
function groupUnits(units: ContextUnit[]): Group[] {
  const groups: Group[] = [];
  for (const unit of units) {
    const header =
      unit.kind === "row" && unit.header ? unit.header.trim() : null;
    const last = groups[groups.length - 1];
    if (header === null) groups.push({ kind: "unit", unit });
    else if (last?.kind === "table" && last.header === header)
      last.units.push(unit);
    else groups.push({ kind: "table", header, units: [unit] });
  }
  return groups;
}

function rowLines(unit: ContextUnit, header: string): string[] {
  const lines = unit.text.split("\n").filter((line) => line.trim());
  return lines[0]?.trim() === header ? lines.slice(1) : lines;
}

/**
 * The note the model read before a line that applies to only some of the
 * chosen model's revisions, when no revision was chosen ("Only v1.2"). The
 * same rule as backend/context.py, revision_notes.
 */
function onlyNote(
  unit: ContextUnit,
  model: string | null,
  revision: string | null,
  modelById: ModelLookup,
): string | null {
  if (!model || revision || unit.masked) return null;
  const revisions = modelById(model)?.revisions ?? [];
  const allowed = unit.revisions[model];
  if (revisions.length < 2 || !allowed?.length) return null;
  if (new Set(allowed).size >= revisions.length) return null;
  const label = (id: string) => revisions.find((r) => r.id === id)?.label ?? id;
  return `Only ${allowed.map(label).join(", ")}`;
}

function OnlyChip({ note }: { note: string }) {
  return (
    <span
      className="chip tiny flat"
      title="Sent with this note: the line applies to only some of this model's revisions"
    >
      {note}
    </span>
  );
}

/** Why a unit was set aside: it is for another model, or another revision. */
function SetAside({
  unit,
  model,
  modelById,
}: {
  unit: ContextUnit;
  model: string | null;
  modelById: ModelLookup;
}) {
  const otherModel =
    !model || (unit.models !== null && !unit.models.includes(model));
  if (otherModel)
    return (
      <>
        <span>Set aside: for</span>
        <ModelTags models={unit.models} other />
      </>
    );
  const revisions = (model && unit.revisions[model]) || [];
  return (
    <span>
      Set aside: for revision{revisions.length === 1 ? "" : "s"}{" "}
      {revisions.map((r) => revisionLabel(modelById, model, r)).join(", ")}
    </span>
  );
}

function ContextUnits({
  units,
  model,
  revision,
  modelById,
}: {
  units: ContextUnit[];
  model: string | null;
  revision: string | null;
  modelById: ModelLookup;
}) {
  const note = (unit: ContextUnit) =>
    onlyNote(unit, model, revision, modelById);
  return (
    <>
      {groupUnits(units).map((group) => {
        if (group.kind === "unit") {
          const { unit } = group;
          const only = note(unit);
          return (
            <div
              key={unit.id}
              className={`unit${unit.matched ? " matched" : ""}${unit.masked ? " masked" : ""}`}
            >
              {(unit.matched || unit.masked || only) && (
                <div className={styles.unitMeta}>
                  {unit.matched && (
                    <span className="chip tiny accent">Matched</span>
                  )}
                  {only && <OnlyChip note={only} />}
                  {unit.masked && (
                    <SetAside unit={unit} model={model} modelById={modelById} />
                  )}
                </div>
              )}
              <div className="unit-text">
                <PassageText
                  text={unit.text}
                  header={unit.header}
                  kind={unit.kind}
                />
              </div>
            </div>
          );
        }
        const head = cells(group.header);
        const flagged = group.units.some(
          (u) => u.matched || u.masked || note(u),
        );
        return (
          <div
            key={group.units[0].id}
            className={`table-wrap ${styles.unitTable}`}
          >
            <table className="table">
              <thead>
                <tr>
                  {head.map((cell, index) => (
                    <th key={index} scope="col">
                      {cell || <span className="sr-only">(blank)</span>}
                    </th>
                  ))}
                  {flagged && (
                    <th scope="col">
                      <span className="sr-only">State</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {group.units.map((unit) => {
                  const only = note(unit);
                  return rowLines(unit, group.header).map((line, index) => (
                    <tr
                      key={`${unit.id}-${index}`}
                      className={
                        unit.masked
                          ? styles.rowMasked
                          : unit.matched
                            ? styles.rowMatched
                            : undefined
                      }
                    >
                      {cells(line).map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                      {flagged && (
                        <td>
                          {index === 0 &&
                            (unit.matched || unit.masked || only) && (
                              <span className={styles.rowState}>
                                {unit.matched && (
                                  <span className="chip tiny accent">
                                    Matched
                                  </span>
                                )}
                                {only && <OnlyChip note={only} />}
                                {unit.masked && (
                                  <SetAside
                                    unit={unit}
                                    model={model}
                                    modelById={modelById}
                                  />
                                )}
                              </span>
                            )}
                        </td>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function ContextItemView({
  item,
  model,
  revision,
  modelById,
}: {
  item: ContextItem;
  model: string | null;
  revision: string | null;
  modelById: ModelLookup;
}) {
  const masked = item.units.filter((unit) => unit.masked).length;
  // The headings above this section; the manual's own name is on the next line.
  const where = item.path
    .slice(item.path[0] === item.docName ? 1 : 0, -1)
    .join(" › ");
  return (
    <details
      id={`context-item-${item.n}`}
      className={styles.item}
      open={item.n === 1}
    >
      <summary>
        <span className="rank">{item.n}</span>
        <span className={styles.itemTitle}>
          <strong>{item.title}</strong>
          {where && <span className="small muted">{where}</span>}
          <span className={styles.where}>
            {item.docName} · {item.location} · {plural(item.words, "word")} sent
          </span>
          <span className="tag-row">
            {item.pinned && (
              <span className="chip tiny accent">Pinned: exact code match</span>
            )}
            {item.partial && (
              <span className="chip tiny warn">
                Partial: the section was over the budget
              </span>
            )}
            {masked > 0 && (
              <span className="chip tiny flat">
                {plural(masked, "line")} set aside
              </span>
            )}
          </span>
        </span>
        <ChevronDown size={18} className={styles.chevron} aria-hidden />
      </summary>
      <div className={styles.itemBody}>
        <ContextUnits
          units={item.units}
          model={model}
          revision={revision}
          modelById={modelById}
        />
      </div>
    </details>
  );
}

const ContextStep = memo(function ContextStep({
  trace,
  chunks,
  model,
  revision,
  modelById,
}: {
  trace: ContextTrace;
  chunks: Record<string, ChunkInfo>;
  model: string | null;
  revision: string | null;
  modelById: ModelLookup;
}) {
  const { items, budget, safetyNotes } = trace;
  const share = budget.budgetWords
    ? Math.min(100, (budget.usedWords / budget.budgetWords) * 100)
    : 0;

  return (
    <>
      <div className={styles.meter}>
        <div className={styles.blockHead}>
          <h3 id="context-budget">Word budget</h3>
          <span className="small">
            <strong>{count(budget.usedWords)}</strong> of{" "}
            {count(budget.budgetWords)} words used
          </span>
        </div>
        <div
          className={styles.meterTrack}
          role="meter"
          aria-labelledby="context-budget"
          aria-valuemin={0}
          aria-valuemax={budget.budgetWords}
          aria-valuenow={budget.usedWords}
          aria-valuetext={`${budget.usedWords} of ${budget.budgetWords} words`}
        >
          <span className={styles.meterFill} style={{ width: `${share}%` }} />
        </div>
      </div>

      <dl className={styles.stats}>
        <Stat label="Sections sent" value={items.length} />
        <Stat
          label="Lines set aside"
          value={trace.masked}
          hint="other models or revisions"
        />
        <Stat
          label="Left out"
          value={budget.skipped.length}
          hint="over the budget"
        />
      </dl>

      {items.length ? (
        <div className={styles.block}>
          <h3>What the model was given</h3>
          <p className={styles.note}>
            Matched lines are marked. Lines set aside belong to another model or
            revision: they stay here, greyed and hatched, and were never sent. A
            line marked &ldquo;Only&rdquo; was sent with a note naming the
            revisions it applies to.
          </p>
          <div className={styles.items}>
            {items.map((item) => (
              <ContextItemView
                key={item.id}
                item={item}
                model={model}
                revision={revision}
                modelById={modelById}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.note}>
          Nothing was kept in step 3, so the context is empty.
        </p>
      )}

      {budget.skipped.length > 0 && (
        <div className={styles.block}>
          <h3>Left out</h3>
          <ul className={styles.skipped}>
            {budget.skipped.map((skip) => (
              <li key={skip.chunkId}>
                <PassageName id={skip.chunkId} chunk={chunks[skip.chunkId]} />
                <span className="small muted">{skip.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.block}>
        <h3>Safety notes</h3>
        {safetyNotes.length ? (
          <>
            <ul className={styles.safety}>
              {safetyNotes.map((note) => (
                <li key={`${note.n}-${note.text}`}>
                  <TriangleAlert size={16} aria-hidden />
                  <span>
                    {note.text}{" "}
                    <button
                      type="button"
                      className="cite"
                      aria-label={`Show passage ${note.n}`}
                      onClick={() => showItem(note.n)}
                    >
                      {note.n}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Picked by rule, not by a model: up to three sentences from these
              passages with a warning word (such as “do not”, “caution” or
              “damage”) that bear on the question. They are shown beside the
              answer whatever it says.
            </p>
          </>
        ) : (
          <p className={styles.note}>
            No warning sentence in these passages bears on the question.
          </p>
        )}
      </div>
    </>
  );
});

// ---------------------------------------------------------------- 5 generate

function GenerateStep({ turn, state }: { turn: Turn; state: StepState }) {
  const done = turn.done;
  const generation = done?.generation ?? null;
  const attempts = generation?.attempts.length
    ? generation.attempts
    : turn.attempts;
  const live = turn.streaming && turn.stage === "generation";
  const raw = generation ? generation.rawAnswer : turn.answer;
  const reasoning = generation?.reasoning || turn.reasoning;
  const prompt = turn.context?.prompt ?? null;
  const items = turn.context?.items ?? done?.sources ?? [];
  const asked = attempts.length > 0;
  const usage = generation?.usage ?? {};

  return (
    <>
      {done && asked && (
        <p className={styles.outcome}>{STATUS[done.status].text}</p>
      )}

      {!asked && !live && (
        <>
          {generation?.error ? (
            <Alert tone={done?.status === "unavailable" ? "bad" : "info"}>
              {generation.error}
            </Alert>
          ) : (
            <Pending state={state} turn={turn} />
          )}
        </>
      )}

      {generation && asked && (
        <dl className={styles.facts}>
          <div>
            <dt>Model</dt>
            <dd className="mono">{generation.model}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{generation.provider}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd className="mono small">{generation.endpoint}</dd>
          </div>
          <div>
            <dt>Parameters</dt>
            <dd>
              temperature {generation.parameters.temperature} · up to{" "}
              {count(generation.parameters.max_tokens)} tokens ·{" "}
              {generation.parameters.stream ? "streamed" : "not streamed"}
            </dd>
          </div>
          <div>
            <dt>On failure</dt>
            <dd>
              Retried up to {plural(generation.retries, "time")}
              {generation.fallbackModels.length
                ? `, then ${generation.fallbackModels.join(", ")}`
                : "; no fallback model is set"}
            </dd>
          </div>
        </dl>
      )}

      {(asked || live) && (
        <div className={styles.block}>
          <h3>Attempts</h3>
          {attempts.length ? (
            <ol className={styles.attempts}>
              {attempts.map((attempt, index) => (
                <li key={`${attempt.model}-${attempt.attempt}-${index}`}>
                  <span
                    className={styles.attemptIcon}
                    data-ok={
                      attempt.ok === null ? undefined : String(attempt.ok)
                    }
                    aria-hidden
                  >
                    {attempt.ok ? (
                      <Check size={13} strokeWidth={3} />
                    ) : attempt.ok === false ? (
                      <X size={13} strokeWidth={3} />
                    ) : (
                      <LoaderCircle size={13} className="spin" />
                    )}
                  </span>
                  <span>
                    <span className="mono">{attempt.model}</span>, attempt{" "}
                    {attempt.attempt}:{" "}
                    {attempt.ok
                      ? "answered"
                      : attempt.ok === false
                        ? `failed${attempt.reason ? `: ${attempt.reason}` : ""}`
                        : live
                          ? "in progress"
                          : "no reply"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.note}>Contacting the model…</p>
          )}
        </div>
      )}

      {generation?.error && asked && (
        <Alert tone="warn">{generation.error}</Alert>
      )}

      {generation && asked && (
        <dl className={styles.stats}>
          <Stat
            label="First word"
            value={formatMs(generation.timings.firstTokenMs)}
            hint={
              generation.timings.firstReasoningMs != null
                ? `thinking began at ${formatMs(generation.timings.firstReasoningMs)}`
                : undefined
            }
          />
          <Stat label="Total" value={formatMs(generation.timings.totalMs)} />
          <Stat
            label="Tokens"
            value={usage.total_tokens != null ? count(usage.total_tokens) : "—"}
            hint={`prompt ${usage.prompt_tokens ?? "—"} · reply ${usage.completion_tokens ?? "—"} · thinking ${usage.reasoning_tokens ?? "—"}`}
          />
          <Stat label="Finish reason" value={generation.finishReason ?? "—"} />
        </dl>
      )}

      {generation && raw && (
        <div className={styles.block}>
          <h3>Citations</h3>
          {generation.citations.valid.length ? (
            <ul className={styles.citations}>
              {generation.citations.valid.map((n) => {
                const item = items.find((i) => i.n === n);
                return (
                  <li key={n}>
                    <button
                      type="button"
                      className="cite"
                      aria-label={`Show passage ${n}`}
                      onClick={() => showItem(n)}
                    >
                      {n}
                    </button>
                    <span>
                      <Check size={13} className={styles.okIcon} aria-hidden />{" "}
                      Valid:{" "}
                      {item
                        ? `${item.title} (${item.location})`
                        : "a passage it was given"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.note}>
              The answer cites no passage it was given.
            </p>
          )}
          {generation.citations.invalid.length > 0 ? (
            <p className={styles.invalid}>
              <X size={14} aria-hidden /> Removed from the answer, because no
              such passage was given:{" "}
              {generation.citations.invalid.map((n) => `[${n}]`).join(" ")}
            </p>
          ) : (
            <p className={styles.note}>No citation had to be removed.</p>
          )}
          <p className={styles.note}>
            A valid number means that passage was in the prompt. Whether the
            sentence says what the passage says is for you to check.
          </p>
        </div>
      )}

      {(raw || live) && (
        <details className={styles.disclosure} open>
          <summary>
            <ChevronDown size={16} className={styles.chevron} aria-hidden />
            <span className={styles.summaryText}>
              <span>The raw answer, as the model wrote it</span>
              <small>{count(raw.length)} characters</small>
            </span>
          </summary>
          <div className={styles.disclosureBody}>
            <pre className={styles.pre} tabIndex={0}>
              {raw}
              {live && <span className="caret" aria-hidden />}
            </pre>
          </div>
        </details>
      )}

      {done?.answer && (
        <details className={styles.disclosure}>
          <summary>
            <ChevronDown size={16} className={styles.chevron} aria-hidden />
            <span className={styles.summaryText}>
              <span>As shown, after the citation check</span>
            </span>
          </summary>
          <div className={styles.disclosureBody}>
            <Markdown text={done.answer} onCite={showItem} />
          </div>
        </details>
      )}

      {reasoning && (
        <details className={styles.disclosure}>
          <summary>
            <ChevronDown size={16} className={styles.chevron} aria-hidden />
            <span className={styles.summaryText}>
              <span>The model&rsquo;s thinking</span>
              <small>
                {count(reasoning.length)} characters, never shown as the answer
              </small>
            </span>
          </summary>
          <div className={styles.disclosureBody}>
            <pre className={styles.pre} tabIndex={0}>
              {reasoning}
            </pre>
          </div>
        </details>
      )}

      {done?.explanation && (
        <div className={styles.block}>
          <h3>Shown instead</h3>
          <p className={styles.note}>{done.explanation.label}</p>
          <ul className={styles.citations}>
            {done.explanation.sentences.map((sentence, index) => (
              <li key={`${index}-${sentence.n}`}>
                <button
                  type="button"
                  className="cite"
                  aria-label={`Show passage ${sentence.n}`}
                  onClick={() => showItem(sentence.n)}
                >
                  {sentence.n}
                </button>
                <span>{sentence.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prompt && (
        <div className={styles.block}>
          <h3>
            {asked || live
              ? "The prompt, exactly as sent"
              : "The prompt Finder built (not sent: no model was asked)"}
          </h3>
          <p className={styles.note}>
            {count(prompt.stats.totalChars)} characters, about{" "}
            {count(prompt.stats.estimatedTokens)} tokens (roughly four
            characters each).{" "}
            {prompt.earlierQuestions.length > 0
              ? `${plural(prompt.earlierQuestions.length, "earlier question")} went along so a follow-up makes sense; no earlier answer did.`
              : "No earlier question went along."}
          </p>
          {prompt.messages.map((message, index) => (
            <details
              key={`${message.kind}-${index}`}
              className={styles.disclosure}
            >
              <summary>
                <ChevronDown size={16} className={styles.chevron} aria-hidden />
                <span className={styles.summaryText}>
                  <span className={styles.role}>{message.role}</span>
                  <span>
                    {message.kind === "instructions"
                      ? "Instructions: the grounding rules and the answer style"
                      : message.kind === "context"
                        ? "Context: the numbered passages and the question"
                        : message.kind}
                  </span>
                  <small>{count(message.content.length)} characters</small>
                </span>
              </summary>
              <div className={styles.disclosureBody}>
                <pre className={styles.pre} tabIndex={0}>
                  {message.content}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the page

function liveText(turn: Turn): string {
  if (turn.streaming) {
    const step = STEPS.find((s) => s.stage === turn.stage);
    return step
      ? `Working: step ${step.n} of 5, ${step.label}.`
      : "Working on this question.";
  }
  if (turn.done?.status === "clarification")
    return `Finder asked ${clarifyWhat(turn.done.clarification)}.`;
  if (turn.done) return STATUS[turn.done.status].text;
  if (turn.error === "Stopped.") return "Stopped before it finished.";
  return turn.error ? "Ended before it finished." : "";
}

export function InspectView() {
  const { inspected, inspect, turns, search, health, modelById } = useFinder();

  if (!inspected)
    return (
      <>
        <PageHead eyebrow="Inspect" title="Step by step">
          What Finder did with one question, from reading it to checking the
          citations.
        </PageHead>
        <div className={`panel empty ${styles.empty}`}>
          <span className={styles.emptyIcon} aria-hidden>
            <ScanEye size={28} />
          </span>
          <h2>Nothing to inspect yet</h2>
          <p>
            Ask a question on the Search page or in Chat. Every step Finder
            takes to answer it will appear here: what it read, what it filtered
            out, what it ranked, what the model was given and what came back.
          </p>
          <Link href="/" className="btn primary">
            Go to Search
          </Link>
        </div>
      </>
    );

  const entries: Entry[] = [
    ...turns.map((turn): Entry => ({ turn, where: "Chat" })),
    ...(search ? [{ turn: search, where: "Search" } as Entry] : []),
  ].sort((a, b) => b.turn.startedAt - a.turn.startedAt);
  const states = stepStates(inspected);
  const status = turnStatus(inspected);
  // The model and revision passages were filtered to (step 2).
  const chosen = inspected.retrieval?.filter ?? inspected.identify?.chosen;
  const [identify, filter, retrieve, context, generate] = STEPS;
  const total = inspected.done?.timings.totalMs;

  return (
    <div className="stack">
      <PageHead
        eyebrow="Inspect"
        title="Step by step"
        aside={
          <div className={styles.aside}>
            <p className={`status ${status.tone}`}>
              <i aria-hidden /> {status.label}
            </p>
            {total != null && (
              <span className={styles.ms}>{formatMs(total)} in all</span>
            )}
          </div>
        }
      >
        What Finder did with one question, from reading it to checking the
        citations, exactly as the backend reported it.
      </PageHead>

      {entries.length > 0 && (
        <RecentTurns
          entries={entries}
          current={inspected.id}
          onPick={inspect}
          modelById={modelById}
        />
      )}

      {inspected.error && (
        <Alert tone={inspected.error === "Stopped." ? "info" : "bad"}>
          {inspected.error === "Stopped."
            ? "This question was stopped before it finished. The steps below show what had arrived."
            : inspected.error}
        </Alert>
      )}

      <div className={styles.railWrap}>
        <StepRail states={states} />
        <p className={styles.live} aria-live="polite">
          {inspected.streaming && (
            <LoaderCircle size={15} className="spin" aria-hidden />
          )}
          {liveText(inspected)}
        </p>
      </div>

      <Step step={identify} state={states.identify} ms={inspected.identify?.ms}>
        {inspected.identify ? (
          <IdentifyStep
            turn={inspected}
            trace={inspected.identify}
            modelById={modelById}
          />
        ) : (
          <Pending state={states.identify} turn={inspected} />
        )}
      </Step>

      <Step step={filter} state={states.filter}>
        {inspected.retrieval ? (
          <FilterStep
            filter={inspected.retrieval.filter}
            excluded={inspected.excluded}
            modelById={modelById}
            cap={health?.retrieval.candidates ?? inspected.retrieval.candidates}
          />
        ) : (
          <Pending state={states.filter} turn={inspected} />
        )}
      </Step>

      <Step
        step={retrieve}
        state={states.retrieve}
        ms={inspected.retrieval?.ms}
      >
        {inspected.retrieval ? (
          <RetrieveStep trace={inspected.retrieval} />
        ) : (
          <Pending state={states.retrieve} turn={inspected} />
        )}
      </Step>

      <Step
        step={context}
        state={states.context}
        ms={
          inspected.context
            ? inspected.context.ms + (inspected.context.prompt?.ms ?? 0)
            : null
        }
      >
        {inspected.context ? (
          <ContextStep
            trace={inspected.context}
            chunks={inspected.retrieval?.chunks ?? {}}
            model={chosen?.model ?? null}
            revision={chosen?.revision ?? null}
            modelById={modelById}
          />
        ) : (
          <Pending state={states.context} turn={inspected} />
        )}
      </Step>

      <Step
        step={generate}
        state={states.generate}
        ms={inspected.done?.generation?.timings.totalMs}
      >
        <GenerateStep turn={inspected} state={states.generate} />
      </Step>
    </div>
  );
}
