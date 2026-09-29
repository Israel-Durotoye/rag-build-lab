"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CircleHelp,
  GraduationCap,
  Layers,
  Loader2,
  RotateCcw,
  Shuffle,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deletePractice,
  getPractice,
  listPractice,
  makePractice,
} from "@/lib/api";
import {
  deckProgress,
  scoreQuiz,
  shuffled,
  type CardMark,
} from "@/lib/practice";
import { plural } from "@/lib/text";
import type {
  CardItem,
  PracticeKind,
  PracticeProgress,
  PracticeSet,
  PracticeSource,
  PracticeSummary,
  QuizItem,
} from "@/lib/types";
import { errorMessage, useStudy } from "./study-provider";
import { NoNotesYet, PageHead } from "./ui";

const KINDS: {
  kind: PracticeKind;
  label: string;
  text: string;
  icon: typeof GraduationCap;
  model: boolean;
}[] = [
  {
    kind: "quiz",
    label: "Quiz",
    text: "Multiple-choice questions with the reason for each answer.",
    icon: CircleHelp,
    model: true,
  },
  {
    kind: "flashcards",
    label: "Flashcards",
    text: "A term or question on the front, the answer on the back.",
    icon: Layers,
    model: true,
  },
  {
    kind: "recall",
    label: "Recall cards",
    text: "A heading on the front, your notes' own text on the back. Needs no model.",
    icon: GraduationCap,
    model: false,
  },
];

const STAGE_TEXT: Record<PracticeProgress["stage"], string> = {
  selecting: "Choosing sections from your notes",
  thinking: "Reading them",
  writing: "Writing",
  retrying: "Trying again",
  checking: "Checking every item against your notes",
};

function Evidence({
  item,
  sources,
}: {
  item: { source: number; quote: string; verified: boolean };
  sources: PracticeSource[];
}) {
  const source = sources[item.source - 1];
  if (!source) return null;
  return (
    <details className="evidence">
      <summary>
        {item.verified ? (
          <span className="tag tag-ok">
            <BadgeCheck size={12} aria-hidden /> quote found in your notes
          </span>
        ) : (
          <span className="tag tag-warn">
            <TriangleAlert size={12} aria-hidden /> quote not found word for
            word
          </span>
        )}
        <span>
          {source.title} · {source.docName} · {source.location}
        </span>
      </summary>
      {item.quote && (
        <blockquote>
          {item.verified ? <mark>{item.quote}</mark> : item.quote}
        </blockquote>
      )}
      {!item.verified && (
        <p className="fine">
          The model offered this quote as proof, but it is not in the section as
          written. Check the item against the section below before relying on
          it.
        </p>
      )}
      <p className="source-text">{source.text}</p>
    </details>
  );
}

function Quiz({ set }: { set: PracticeSet & { kind: "quiz" } }) {
  const [order, setOrder] = useState<QuizItem[]>(set.items);
  const [at, setAt] = useState(0);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [view, setView] = useState<"questions" | "result">("questions");
  const score = scoreQuiz(order, chosen);
  const item = order[at];
  const picked = item ? chosen[item.id] : undefined;
  const finished = score.answered === order.length;

  const restart = (items: QuizItem[]) => {
    setOrder(items);
    setChosen({});
    setAt(0);
    setView("questions");
  };

  if (view === "result")
    return (
      <div className="result">
        <p className="result-score">
          <strong>{score.correct}</strong> of {score.total}
        </p>
        <p className="muted">
          {score.missed.length
            ? `${plural(score.missed.length, "question")} to look at again.`
            : "Every answer was right."}
        </p>
        <div className="row">
          <button
            type="button"
            className="button"
            onClick={() => {
              setAt(0);
              setView("questions");
            }}
          >
            Review the answers
          </button>
          {score.missed.length > 0 && (
            <button
              type="button"
              className="button button-outline"
              onClick={() =>
                restart(set.items.filter((i) => score.missed.includes(i.id)))
              }
            >
              <RotateCcw size={14} aria-hidden /> Retry the ones I missed
            </button>
          )}
          <button
            type="button"
            className="button button-outline"
            onClick={() => restart(shuffled(set.items))}
          >
            <Shuffle size={14} aria-hidden /> Start over
          </button>
        </div>
      </div>
    );
  if (!item) return null;

  return (
    <div className="quiz">
      <p className="quiz-count">
        Question {at + 1} of {order.length}
        <span className="dots" aria-hidden>
          {order.map((q, index) => (
            <i
              key={q.id}
              data-state={
                !(q.id in chosen)
                  ? index === at
                    ? "current"
                    : "todo"
                  : chosen[q.id] === q.answer
                    ? "right"
                    : "wrong"
              }
            />
          ))}
        </span>
      </p>
      <h2 className="quiz-question">{item.question}</h2>
      <ol className="options">
        {item.options.map((option, index) => {
          const state =
            picked === undefined
              ? undefined
              : index === item.answer
                ? "right"
                : index === picked
                  ? "wrong"
                  : "rest";
          return (
            <li key={option}>
              <button
                type="button"
                data-state={state}
                disabled={picked !== undefined}
                onClick={() => setChosen((c) => ({ ...c, [item.id]: index }))}
              >
                <span className="option-key">
                  {state === "right" ? (
                    <Check size={13} strokeWidth={3} aria-label="correct" />
                  ) : state === "wrong" ? (
                    <X
                      size={13}
                      strokeWidth={3}
                      aria-label="your answer, incorrect"
                    />
                  ) : (
                    String.fromCharCode(65 + index)
                  )}
                </span>
                {option}
              </button>
            </li>
          );
        })}
      </ol>
      {picked !== undefined && (
        <div className="feedback" data-right={picked === item.answer}>
          <p>
            <strong>{picked === item.answer ? "Right." : "Not quite."}</strong>{" "}
            {item.explanation}
          </p>
          <Evidence item={item} sources={set.sources} />
        </div>
      )}
      <div className="row">
        <button
          type="button"
          className="button button-outline"
          disabled={at === 0}
          onClick={() => setAt(at - 1)}
        >
          <ArrowLeft size={14} aria-hidden /> Back
        </button>
        {at < order.length - 1 ? (
          <button
            type="button"
            className="button"
            disabled={picked === undefined}
            onClick={() => setAt(at + 1)}
          >
            Next <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!finished}
            onClick={() => setView("result")}
          >
            See the result
          </button>
        )}
      </div>
    </div>
  );
}

function Deck({
  set,
}: {
  set: PracticeSet & { kind: "flashcards" | "recall" };
}) {
  const [order, setOrder] = useState<CardItem[]>(set.items);
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<string, CardMark>>({});
  const card = order[at];
  const progress = deckProgress(
    order.map((c) => c.id),
    marks,
  );

  const move = useCallback(
    (step: number) => {
      setFlipped(false);
      setAt((current) =>
        Math.min(order.length - 1, Math.max(0, current + step)),
      );
    },
    [order.length],
  );
  const mark = useCallback(
    (value: CardMark) => {
      if (!card) return;
      setMarks((m) => ({ ...m, [card.id]: value }));
      move(1);
    },
    [card, move],
  );
  const restart = (items: CardItem[]) => {
    setOrder(items);
    setMarks({});
    setAt(0);
    setFlipped(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, summary")) return;
      if (event.key === " ") {
        if (target?.closest("button")) return;
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  if (progress.done)
    return (
      <div className="result">
        <p className="result-score">
          <strong>{progress.known}</strong> of {order.length}
        </p>
        <p className="muted">
          {progress.again
            ? `${plural(progress.again, "card")} to go through again.`
            : "You knew every card."}
        </p>
        <div className="row">
          {progress.again > 0 && (
            <button
              type="button"
              className="button"
              onClick={() =>
                restart(order.filter((c) => marks[c.id] === "again"))
              }
            >
              <RotateCcw size={14} aria-hidden /> Go through those again
            </button>
          )}
          <button
            type="button"
            className="button button-outline"
            onClick={() => restart(shuffled(set.items))}
          >
            <Shuffle size={14} aria-hidden /> Shuffle and start over
          </button>
        </div>
      </div>
    );
  if (!card) return null;

  return (
    <div className="deck">
      <p className="quiz-count">
        Card {at + 1} of {order.length}
        <span className="muted">
          {progress.known} known · {progress.again} again
        </span>
      </p>
      <button
        type="button"
        className="flashcard"
        data-flipped={flipped || undefined}
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show the front" : "Show the answer"}
      >
        <span className="flashcard-side">{flipped ? "Answer" : "Prompt"}</span>
        <span className="flashcard-text">
          {flipped ? card.back : card.front}
        </span>
        <span className="flashcard-hint">
          {flipped
            ? "Click to see the prompt"
            : "Click or press space to turn over"}
        </span>
      </button>
      {flipped && <Evidence item={card} sources={set.sources} />}
      <div className="row">
        <button
          type="button"
          className="button button-outline"
          disabled={at === 0}
          onClick={() => move(-1)}
          aria-label="Previous card"
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="button button-again"
          disabled={!flipped}
          onClick={() => mark("again")}
        >
          <RotateCcw size={14} aria-hidden /> Again
        </button>
        <button
          type="button"
          className="button"
          disabled={!flipped}
          onClick={() => mark("known")}
        >
          <Check size={14} aria-hidden /> I knew it
        </button>
        <button
          type="button"
          className="button button-outline"
          disabled={at === order.length - 1}
          onClick={() => move(1)}
          aria-label="Next card"
        >
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function PracticeView() {
  const { health, documents } = useStudy();
  const [pickedKind, setKind] = useState<PracticeKind | null>(null);
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState("");
  const [chosenNotes, setChosenNotes] = useState<string[]>([]);
  const [sets, setSets] = useState<PracticeSummary[]>([]);
  const [current, setCurrent] = useState<PracticeSet | null>(null);
  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const saved = await listPractice();
      setSets(saved);
    } catch {
      /* the list is a convenience; making a set reports real problems */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listPractice()
      .then((saved) => alive && setSets(saved))
      .catch(() => undefined);
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const generation = !!health?.generation;
  // Without a model only recall cards can be made, whatever was picked.
  const kind: PracticeKind = generation ? (pickedKind ?? "quiz") : "recall";

  const [low, high] = health?.practice.count ?? [3, 12];
  const notes = useMemo(
    () => (documents ?? []).filter((d) => chosenNotes.includes(d.id)),
    [chosenNotes, documents],
  );

  const make = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setCurrent(null);
    setProgress({ stage: "selecting" });
    try {
      const made = await makePractice(
        {
          kind,
          count,
          focus: focus.trim(),
          ...(notes.length ? { documentIds: notes.map((d) => d.id) } : {}),
        },
        setProgress,
        controller.signal,
      );
      setCurrent(made);
      void refresh();
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError")
        setError(errorMessage(cause, "The practice set could not be made."));
    } finally {
      setProgress(null);
    }
  };

  const open = async (id: string) => {
    setError(null);
    try {
      setCurrent(await getPractice(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(errorMessage(cause, "This set could not be opened."));
    }
  };

  const remove = async (id: string) => {
    try {
      await deletePractice(id);
      if (current?.id === id) setCurrent(null);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, "This set could not be removed."));
    }
  };

  if (documents && !documents.length)
    return (
      <NoNotesYet what="Practice sets are written from your notes, so there is nothing to practise yet." />
    );

  const flagged = current
    ? current.items.filter((item) => !item.verified).length
    : 0;

  return (
    <div className="practice">
      <PageHead
        eyebrow="Practise"
        title={
          <>
            Test yourself on <em>what your notes say</em>
          </>
        }
      >
        Every item names the section it was written from and quotes the sentence
        that proves it. The quote is checked against your notes word for word
        before you see the item.
      </PageHead>

      <div className="practice-layout">
        <div className="practice-main">
          {current ? (
            <section className="card session">
              <header className="session-head">
                <div>
                  <h2>{current.title}</h2>
                  <p className="fine">
                    {plural(current.items.length, "item")} from{" "}
                    {plural(current.sources.length, "section")}
                    {current.model
                      ? ` · written by ${current.model}`
                      : " · your notes' own text, no model"}
                    {current.dropped > 0 &&
                      ` · ${plural(current.dropped, "item")} dropped for not matching your notes`}
                    {flagged > 0 &&
                      ` · ${plural(flagged, "quote")} could not be found word for word`}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setCurrent(null)}
                >
                  Make another
                </button>
              </header>
              {current.kind === "quiz" ? (
                <Quiz key={current.id} set={current} />
              ) : (
                <Deck key={current.id} set={current} />
              )}
            </section>
          ) : (
            <form
              className="card practice-form"
              onSubmit={(event) => {
                event.preventDefault();
                void make();
              }}
            >
              <fieldset className="kinds" disabled={!!progress}>
                <legend>What would you like?</legend>
                {KINDS.map(
                  ({ kind: value, label, text, icon: Icon, model }) => (
                    <label
                      key={value}
                      className="kind"
                      data-disabled={(model && !generation) || undefined}
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={value}
                        checked={kind === value}
                        disabled={model && !generation}
                        onChange={() => setKind(value)}
                      />
                      <Icon size={18} aria-hidden />
                      <strong>{label}</strong>
                      <small>
                        {model && !generation
                          ? "Needs a model key on the server."
                          : text}
                      </small>
                    </label>
                  ),
                )}
              </fieldset>
              <div className="lab-options">
                <label className="field">
                  <span>How many</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={low}
                    max={high}
                    value={count}
                    disabled={!!progress}
                    onChange={(event) => setCount(Number(event.target.value))}
                  />
                </label>
                <label className="field field-grow">
                  <span>Focus on (optional)</span>
                  <input
                    value={focus}
                    maxLength={200}
                    disabled={!!progress}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="e.g. integral action and windup"
                  />
                </label>
              </div>
              {(documents?.length ?? 0) > 1 && (
                <fieldset className="notes-pick" disabled={!!progress}>
                  <legend>From which notes? (all, unless you choose)</legend>
                  {documents!.map((d) => (
                    <label key={d.id} className="check">
                      <input
                        type="checkbox"
                        checked={chosenNotes.includes(d.id)}
                        onChange={(event) =>
                          setChosenNotes((ids) =>
                            event.target.checked
                              ? [...ids, d.id]
                              : ids.filter((id) => id !== d.id),
                          )
                        }
                      />
                      <span>{d.name}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="row">
                <button
                  type="submit"
                  className="button"
                  disabled={
                    !!progress ||
                    !health ||
                    !Number.isInteger(count) ||
                    count < low ||
                    count > high
                  }
                >
                  {progress ? (
                    <Loader2 size={15} className="spin" aria-hidden />
                  ) : (
                    <GraduationCap size={15} aria-hidden />
                  )}
                  {kind === "quiz"
                    ? "Write a quiz"
                    : kind === "flashcards"
                      ? "Write flashcards"
                      : "Make recall cards"}
                </button>
                {progress && (
                  <>
                    <p className="muted" role="status">
                      {STAGE_TEXT[progress.stage]}
                      {progress.chars
                        ? ` — ${progress.chars.toLocaleString("en")} characters`
                        : "…"}
                      {progress.reason ? ` (${progress.reason})` : ""}
                    </p>
                    <button
                      type="button"
                      className="link"
                      onClick={() => abort.current?.abort()}
                    >
                      Stop
                    </button>
                  </>
                )}
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {kind !== "recall" && (
                <p className="fine">
                  A model can take half a minute to write a set. It reads up to
                  eight sections: the ones nearest your focus, or a spread
                  across your notes.
                </p>
              )}
            </form>
          )}
          {current && error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>

        <aside className="practice-rail">
          <h3 className="section-title">Saved sets</h3>
          {sets.length ? (
            <ul className="set-list">
              {sets.map((set) => (
                <li
                  key={set.id}
                  aria-current={current?.id === set.id || undefined}
                >
                  <button type="button" onClick={() => void open(set.id)}>
                    <strong>{set.title}</strong>
                    <small>
                      {plural(set.count, "item")} ·{" "}
                      {new Date(set.createdAt).toLocaleDateString()}
                      {set.verified < set.count &&
                        ` · ${set.count - set.verified} unverified`}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${set.title}`}
                    onClick={() => void remove(set.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Sets you make are kept here, so you can come back to them.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
