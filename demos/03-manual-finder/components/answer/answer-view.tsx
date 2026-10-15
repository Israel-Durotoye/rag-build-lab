"use client";

import { Clock, Microchip, RotateCcw, ScanEye } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMs } from "@/lib/text";
import { newTurn, runTurn } from "@/lib/turns";
import type {
  AskRequest,
  ModelRef,
  RetrievalMode,
  RevisionRef,
  Turn,
} from "@/lib/types";
import { useFinder } from "../finder-provider";
import { Alert } from "../ui";
import { AnswerColumn } from "./answer-column";
import { ClarifyCard } from "./clarify-card";
import { CompareControls, CompareView } from "./compare-models";
import { questionFor, statusText } from "./shared";
import { StageProgress, stageLabel } from "./stage-progress";
import styles from "./answer-view.module.css";

export interface AnswerViewProps {
  turn: Turn;
  /** A chat reply: tighter, its passages folded until a citation opens them. */
  compact?: boolean;
  /**
   * A model chosen from Finder's question ("Which model is this for?"), with
   * the question to ask now: the same one, or with the chosen model's name in
   * place of a name that fitted several models.
   */
  onChooseModel: (modelId: string, question: string) => void;
  /** A revision chosen from Finder's question ("Which revision?"). */
  onChooseRevision: (
    modelId: string,
    revisionId: string,
    question: string,
  ) => void;
  /** Ask again: the same question after an error, or a corrected one ("Did you mean …"). */
  onRetry: (question: string) => void;
  /** Told about "Same question, other model" as its answer streams in. */
  onCompare?: (other: Turn) => void;
}

const MODE: Record<RetrievalMode, string> = {
  hybrid: "Hybrid search",
  keyword: "Keyword search",
  semantic: "Semantic search",
};

/** Controllers the reader stopped, as opposed to ones replaced or closed. */
const stoppedByReader = new WeakSet<AbortController>();

function refOf(
  model: { id: string; name: string; short: string } | undefined,
): ModelRef | null {
  return model ? { id: model.id, name: model.name, short: model.short } : null;
}

/** Which model the answer is for, how Finder knew, and how the question was read. */
function ForLine({ turn }: { turn: Turn }) {
  const { modelById } = useFinder();
  const identify = turn.identify;
  if (!identify || turn.clarification) return null;
  const chosen = identify.chosen;
  const library = modelById(chosen.model);
  const model = turn.done?.model ?? refOf(library);
  const revision: RevisionRef | null =
    turn.done?.revision ??
    library?.revisions.find((r) => r.id === chosen.revision) ??
    null;
  const readAs = turn.done?.readAs ?? identify.readAs;
  // A follow-up in a chat can keep the model an earlier question named.
  const namedHere = identify.mentions.some(
    (m) => m.kind === "model" || m.kind === "family" || m.kind === "revision",
  );
  const how =
    chosen.source === "question"
      ? namedHere
        ? "named in your question"
        : "named earlier in this conversation"
      : chosen.source === "picker"
        ? "the model you're working on"
        : null;
  const retrieval = turn.retrieval;
  const fellBack = retrieval && retrieval.mode !== retrieval.requestedMode;
  const unfiltered =
    !model && chosen.source === "none" && Boolean(retrieval || turn.done);

  return (
    <div className={styles.forLine}>
      {model && (
        <p className={styles.forModel}>
          <Microchip size={16} aria-hidden />
          <span>
            For the <strong>{model.name}</strong>
            {revision ? ` (${revision.label})` : ""}
            {how && <span className={styles.how}> · {how}</span>}
          </span>
        </p>
      )}
      {unfiltered && (
        <p className={styles.forModel}>
          <Microchip size={16} aria-hidden />
          <span>
            No model filter: the manuals in this library don&rsquo;t name any
            models.
          </span>
        </p>
      )}
      {readAs.map((text) => (
        <span
          key={text}
          className="chip tiny accent"
          title="Your question wrote this code another way; Finder searched for the manual's own spelling."
        >
          Read as <span className={styles.code}>{text}</span>
        </span>
      ))}
      {retrieval && (
        <span
          className={styles.mode}
          title={fellBack ? retrieval.semantic.reason : undefined}
        >
          {MODE[retrieval.mode]}
          {fellBack ? " (semantic search wasn't available)" : ""}
        </span>
      )}
    </div>
  );
}

/**
 * One question's answer at any stage: progress while it runs, Finder's
 * question when it needs a model, the fault card, the explanation, the
 * manual's warnings, the passages and what was set aside for other models.
 * "Same question, other model" runs a second question beside it.
 */
export function AnswerView(props: AnswerViewProps) {
  // A new question starts with fresh local state (and no comparison).
  return <AnswerBody key={props.turn.id} {...props} />;
}

function AnswerBody({
  turn,
  compact = false,
  onChooseModel,
  onChooseRevision,
  onRetry,
  onCompare,
}: AnswerViewProps) {
  const { health, library, inspect, modelById } = useFinder();
  const [other, setOther] = useState<Turn | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  // Replacing, closing or leaving a comparison stops its stream.
  useEffect(() => () => controller?.abort(), [controller]);

  const compare = (modelId: string, revisionId: string | null = null) => {
    const next = new AbortController();
    setController(next);
    const question = questionFor(turn, modelById(modelId)?.name ?? modelId);
    const conversation = turn.done?.conversation;
    const earlier = conversation?.followUp
      ? conversation.topic.slice(0, -1)
      : [];
    const request: AskRequest = {
      message: question,
      model: modelId,
      revision: revisionId,
      mode: turn.mode,
      ...(earlier.length ? { earlier, followUp: true } : {}),
    };
    const first = newTurn(
      question,
      { model: modelId, revision: revisionId },
      turn.mode,
    );
    setOther(first);
    onCompare?.(first);
    void runTurn(
      first,
      request,
      (update) => {
        if (next.signal.aborted && !stoppedByReader.has(next)) return;
        setOther(update);
        onCompare?.(update);
      },
      next.signal,
    );
  };

  const stopCompare = () => {
    if (!controller) return;
    stoppedByReader.add(controller);
    controller.abort();
  };

  const closeCompare = () => {
    setOther(null);
    setController(null);
  };

  const done = turn.done;
  const chosenModel =
    done?.model ?? refOf(modelById(turn.identify?.chosen.model));
  const generation = health?.generation ?? true;
  const stopped = turn.error === "Stopped.";
  const canCompare =
    Boolean(done) &&
    !turn.clarification &&
    !!chosenModel &&
    (library?.models.length ?? 0) > 1;
  const live = turn.streaming
    ? `${stageLabel(turn.stage ?? "identify", chosenModel?.short ?? null, generation)}…`
    : turn.error
      ? turn.error
      : turn.clarification
        ? turn.clarification.message
        : done
          ? statusText(done.status, done.model, done.revision)
          : "";

  return (
    <section
      className={`${styles.answer}${compact ? ` ${styles.compact}` : ""}`}
      aria-label="Answer"
      aria-busy={turn.streaming}
    >
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <ForLine turn={turn} />
      {turn.streaming && (
        <StageProgress
          turn={turn}
          model={chosenModel?.short ?? null}
          generation={generation}
        />
      )}

      {turn.clarification ? (
        <ClarifyCard
          clarification={turn.clarification}
          mentions={turn.identify?.mentions}
          onChooseModel={onChooseModel}
          onChooseRevision={onChooseRevision}
        />
      ) : other ? (
        <CompareView
          key={other.id}
          turn={turn}
          other={other}
          onRun={compare}
          onStop={stopCompare}
          onClose={closeCompare}
          onChooseModel={onChooseModel}
          onChooseRevision={onChooseRevision}
          onRetry={onRetry}
        />
      ) : (
        <AnswerColumn
          turn={turn}
          compact={compact}
          onRetry={onRetry}
          onCompare={canCompare ? (modelId) => compare(modelId) : undefined}
        />
      )}

      {turn.error && (
        <Alert tone={stopped ? "info" : "bad"}>
          <div className={styles.error}>
            <span>
              {stopped ? "Stopped before the answer was complete." : turn.error}
            </span>
            <button
              type="button"
              className="btn small"
              onClick={() => onRetry(turn.question)}
            >
              <RotateCcw size={14} aria-hidden />{" "}
              {stopped ? "Ask again" : "Try again"}
            </button>
          </div>
        </Alert>
      )}

      {canCompare && !other && (
        <CompareControls
          turn={turn}
          compact={compact}
          onRun={(modelId) => compare(modelId)}
        />
      )}

      {(turn.identify || done) && (
        <footer className={styles.footer}>
          <Link
            href="/inspect"
            className="btn quiet small"
            onClick={() => inspect(turn.id)}
          >
            <ScanEye size={15} aria-hidden /> Inspect this answer
          </Link>
          {done?.timings.totalMs != null && (
            <span className={styles.time}>
              <Clock size={13} aria-hidden /> {formatMs(done.timings.totalMs)}
            </span>
          )}
        </footer>
      )}
    </section>
  );
}
