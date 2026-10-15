"use client";

import { Columns2, RotateCcw, Square, X } from "lucide-react";
import { useId, useState } from "react";
import type { Library, LibraryModel, ModelRef, Turn } from "@/lib/types";
import { useFinder } from "../finder-provider";
import { Alert } from "../ui";
import { AnswerColumn } from "./answer-column";
import { ClarifyCard } from "./clarify-card";
import {
  cardMarks,
  compareSides,
  type CardMark,
  type SideDiff,
} from "./shared";
import { StageProgress } from "./stage-progress";
import styles from "./compare-models.module.css";

/** The models to offer, grouped by family the way the picker groups them. */
function ModelOptions({
  library,
  exclude,
}: {
  library: Library;
  exclude: string | null;
}) {
  const others = library.models.filter((m) => m.id !== exclude);
  const groups = library.families
    .map((family) => ({
      id: family.id,
      name: family.name,
      models: others.filter((m) => m.family === family.id),
    }))
    .filter((group) => group.models.length);
  const loose = others.filter(
    (m) => !m.family || !library.families.some((f) => f.id === m.family),
  );
  const option = (model: LibraryModel) => (
    <option key={model.id} value={model.id}>
      {model.name}
      {model.short !== model.name ? ` (${model.short})` : ""}
    </option>
  );
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.models.map(option)}
        </optgroup>
      ))}
      {loose.length > 0 &&
        (groups.length ? (
          <optgroup label="Other models">{loose.map(option)}</optgroup>
        ) : (
          loose.map(option)
        ))}
    </>
  );
}

/** A look-alike first: a model the code means something else on, then the same family. */
function preferredOther(
  turn: Turn,
  others: LibraryModel[],
  current: LibraryModel | undefined,
): string {
  const card = turn.card;
  const hinted =
    card?.kind === "found"
      ? card.differsIn
      : card?.kind === "not_found"
        ? card.elsewhere
        : [];
  const pick =
    hinted.find((m) => others.some((o) => o.id === m.id))?.id ??
    others.find((m) => current?.family && m.family === current.family)?.id ??
    others[0]?.id;
  return pick ?? "";
}

function ModelSelect({
  id,
  value,
  onChange,
  exclude,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  exclude: string | null;
}) {
  const { library } = useFinder();
  if (!library) return null;
  return (
    <span className={`field ${styles.select}`}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <ModelOptions library={library} exclude={exclude} />
      </select>
    </span>
  );
}

/**
 * "Same question, other model": choose another model and Finder asks the
 * same question for it, to show both answers side by side.
 */
export function CompareControls({
  turn,
  compact = false,
  onRun,
}: {
  turn: Turn;
  compact?: boolean;
  onRun: (modelId: string) => void;
}) {
  const { library, modelById } = useFinder();
  const titleId = useId();
  const selectId = useId();
  const current = turn.done?.model?.id ?? turn.identify?.chosen.model ?? null;
  const others = (library?.models ?? []).filter((m) => m.id !== current);
  const [choice, setChoice] = useState(() =>
    preferredOther(turn, others, modelById(current)),
  );
  const [open, setOpen] = useState(!compact);
  if (!others.length) return null;
  const value = others.some((m) => m.id === choice) ? choice : others[0].id;

  if (!open)
    return (
      <button
        type="button"
        className={`btn quiet small ${styles.reveal}`}
        onClick={() => setOpen(true)}
      >
        <Columns2 size={15} aria-hidden /> Same question, other model
      </button>
    );

  return (
    <section className={`flat ${styles.controls}`} aria-labelledby={titleId}>
      <div className={styles.controlsText}>
        <h2 id={titleId} className={styles.controlsTitle}>
          <Columns2 size={17} aria-hidden /> Same question, other model
        </h2>
        <p className="small muted">
          Ask this again for another model and read both answers side by side,
          with the passages that differ marked.
        </p>
      </div>
      <form
        className={styles.controlsForm}
        onSubmit={(event) => {
          event.preventDefault();
          onRun(value);
        }}
      >
        <label htmlFor={selectId} className={styles.selectLabel}>
          Other model
        </label>
        <ModelSelect
          id={selectId}
          value={value}
          onChange={setChoice}
          exclude={current}
        />
        <button type="submit" className="btn">
          Compare
        </button>
      </form>
    </section>
  );
}

function refOf(model: LibraryModel | undefined): ModelRef | null {
  return model ? { id: model.id, name: model.name, short: model.short } : null;
}

function Side({
  turn,
  caption,
  diff,
  cardMark,
  onChooseModel,
  onChooseRevision,
  onRetry,
  onAgain,
  onCompare,
}: {
  turn: Turn;
  caption: string;
  diff?: SideDiff;
  cardMark: CardMark | null;
  onChooseModel: (modelId: string, question: string) => void;
  onChooseRevision: (
    modelId: string,
    revisionId: string,
    question: string,
  ) => void;
  onRetry?: (question: string) => void;
  /** Run this side again after an error. */
  onAgain: () => void;
  onCompare?: (modelId: string) => void;
}) {
  const { health, modelById } = useFinder();
  const titleId = useId();
  const model =
    turn.done?.model ??
    refOf(modelById(turn.identify?.chosen.model ?? turn.selection.model));
  const revision = turn.done?.revision?.label;
  const stopped = turn.error === "Stopped.";
  return (
    <article className={styles.side} aria-labelledby={titleId}>
      <header className={styles.sideHead}>
        <span className={`mono ${styles.sideShort}`} aria-hidden>
          {model?.short ?? "…"}
        </span>
        <div className={styles.sideTitle}>
          <h3 id={titleId}>
            {model ? model.name : "Finding the model"}
            {revision ? ` (${revision})` : ""}
          </h3>
          <p className="small muted">{caption}</p>
        </div>
      </header>
      {turn.streaming && (
        <StageProgress
          turn={turn}
          model={model?.short ?? null}
          generation={health?.generation ?? true}
        />
      )}
      {turn.clarification ? (
        <ClarifyCard
          clarification={turn.clarification}
          mentions={turn.identify?.mentions}
          onChooseModel={onChooseModel}
          onChooseRevision={onChooseRevision}
          level={4}
        />
      ) : (
        <AnswerColumn
          turn={turn}
          level={4}
          diff={diff}
          cardMark={cardMark}
          showExcluded={false}
          onRetry={onRetry}
          onCompare={onCompare}
        />
      )}
      {turn.error && (
        <Alert tone={stopped ? "info" : "bad"}>
          <div className={styles.error}>
            <span>{turn.error}</span>
            <button type="button" className="btn small" onClick={onAgain}>
              <RotateCcw size={14} aria-hidden />{" "}
              {stopped ? "Ask again" : "Try again"}
            </button>
          </div>
        </Alert>
      )}
    </article>
  );
}

/**
 * Two answers to one question, one per model, side by side. Passages are
 * compared once case, punctuation and spacing are set aside: a passage both
 * sides read is "Same in both manuals"; text only one side has is "Only in
 * this manual". Fault cards for the same code say whether the meaning differs.
 */
export function CompareView({
  turn,
  other,
  onRun,
  onStop,
  onClose,
  onChooseModel,
  onChooseRevision,
  onRetry,
}: {
  turn: Turn;
  other: Turn;
  /** Run the other side again, for this model (and revision). */
  onRun: (modelId: string, revisionId?: string | null) => void;
  onStop: () => void;
  onClose: () => void;
  onChooseModel: (modelId: string, question: string) => void;
  onChooseRevision: (
    modelId: string,
    revisionId: string,
    question: string,
  ) => void;
  onRetry: (question: string) => void;
}) {
  const { modelById } = useFinder();
  const titleId = useId();
  const selectId = useId();
  const current = turn.done?.model?.id ?? turn.identify?.chosen.model ?? null;
  const otherId = other.selection.model ?? "";
  const [choice, setChoice] = useState(otherId);

  const mine = turn.done ? turn.done.sources : (turn.context?.items ?? []);
  const theirs = other.done ? other.done.sources : (other.context?.items ?? []);
  // Marks appear once the other side has read its passages.
  const settled = Boolean(other.context || other.done) && !other.clarification;
  const leftDiff = settled ? compareSides(mine, theirs) : undefined;
  const rightDiff = settled ? compareSides(theirs, mine) : undefined;
  const leftName =
    turn.done?.model?.short ?? modelById(current)?.short ?? "this model";
  const rightName =
    other.done?.model?.short ?? modelById(otherId)?.short ?? "the other model";

  return (
    <section className={styles.view} aria-labelledby={titleId}>
      <header className={styles.viewHead}>
        <div className={styles.viewTitle}>
          <span className="eyebrow">Same question, other model</span>
          <h2 id={titleId}>
            {leftName} beside {rightName}
          </h2>
        </div>
        <form
          className={styles.viewControls}
          onSubmit={(event) => {
            event.preventDefault();
            if (choice) onRun(choice);
          }}
        >
          <label htmlFor={selectId} className="sr-only">
            Other model
          </label>
          <ModelSelect
            id={selectId}
            value={choice}
            onChange={setChoice}
            exclude={current}
          />
          <button type="submit" className="btn small" disabled={!choice}>
            Compare
          </button>
          {other.streaming && (
            <button type="button" className="btn small" onClick={onStop}>
              <Square size={13} aria-hidden /> Stop
            </button>
          )}
          <button
            type="button"
            className="btn icon small"
            onClick={onClose}
            aria-label="Close the comparison"
            title="Close the comparison"
          >
            <X size={16} aria-hidden />
          </button>
        </form>
      </header>
      {other.question !== turn.question && (
        <p className="small muted">
          Asked for the {rightName} as <q>{other.question}</q>
        </p>
      )}
      <p className={styles.legend}>
        Passages are compared with case, punctuation and spacing ignored.
        <span className="chip tiny accent">Same in both manuals</span>
        <span className="chip tiny warn">Only in this manual</span>
      </p>
      <div className={styles.sides}>
        <Side
          turn={turn}
          caption="This answer"
          diff={leftDiff}
          cardMark={cardMarks(turn.card, other.card)}
          onChooseModel={onChooseModel}
          onChooseRevision={onChooseRevision}
          onRetry={onRetry}
          onAgain={() => onRetry(turn.question)}
          onCompare={(modelId) => {
            setChoice(modelId);
            onRun(modelId);
          }}
        />
        <Side
          turn={other}
          caption="The same question for another model"
          diff={rightDiff}
          cardMark={cardMarks(other.card, turn.card)}
          onChooseModel={(modelId) => onRun(modelId)}
          onChooseRevision={(modelId, revisionId) => onRun(modelId, revisionId)}
          onAgain={() => onRun(otherId, other.selection.revision)}
        />
      </div>
    </section>
  );
}
