"use client";

import {
  CircleCheck,
  CircleHelp,
  Quote,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import type { AnswerStatus, Turn } from "@/lib/types";
import { Markdown } from "../markdown";
import { statusText, WRITTEN } from "./shared";
import styles from "./explanation.module.css";

const TONE: Record<
  AnswerStatus,
  { tone: "ok" | "warn" | "quiet" | "info"; icon: LucideIcon }
> = {
  answered: { tone: "ok", icon: CircleCheck },
  uncited: { tone: "warn", icon: TriangleAlert },
  not_found: { tone: "quiet", icon: SearchX },
  interrupted: { tone: "warn", icon: TriangleAlert },
  unavailable: { tone: "warn", icon: TriangleAlert },
  sources_only: { tone: "info", icon: Quote },
  no_passages: { tone: "quiet", icon: SearchX },
  clarification: { tone: "info", icon: CircleHelp },
};

/**
 * The written part of an answer: the model's explanation as it streams and
 * once its citations are checked, or, when no model could write one, the
 * manual's own sentences, labelled as such. One plain line says how the
 * answer ended.
 */
export function Explanation({
  turn,
  onCite,
  level = 2,
}: {
  turn: Turn;
  onCite: (n: number) => void;
  level?: 2 | 3 | 4 | 5;
}) {
  const titleId = useId();
  const Heading = `h${level}` as const;
  const done = turn.done;
  if (turn.clarification) return null;

  const writing = turn.streaming && turn.stage === "generation";
  // Stopped or cut off while writing: what arrived is still shown.
  const partial = !done && !turn.streaming && turn.answer ? turn.answer : null;
  const written =
    done && WRITTEN.has(done.status) && done.answer ? done.answer : null;
  const finished = written ?? partial;
  const extractive =
    done &&
    (done.status === "sources_only" || done.status === "unavailable") &&
    done.explanation?.sentences.length
      ? done.explanation
      : null;
  if (!done && !writing && !partial) return null;

  const status = done ? TONE[done.status] : null;
  const StatusIcon = status?.icon;
  const retrying = turn.streaming && turn.attempts.length > 1;

  return (
    <section
      className={`panel ${styles.explanation}`}
      aria-labelledby={titleId}
    >
      <header className={styles.head}>
        <Heading id={titleId} className={styles.title}>
          {extractive ? "The manual's own words" : "Explanation"}
        </Heading>
        {written && done?.generation?.model && (
          <span className={styles.by}>Written by {done.generation.model}</span>
        )}
        {extractive && <span className="chip tiny flat">Not generated</span>}
      </header>

      {writing && !turn.answer && (
        <div className={styles.waiting}>
          <p className="small muted">
            {retrying
              ? `The first attempt failed. Trying again with ${turn.attempts.at(-1)?.model}…`
              : turn.reasoning
                ? "The model is working through the passages…"
                : "The model is reading the passages…"}
          </p>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className={`skeleton ${styles.short}`} />
        </div>
      )}

      {turn.streaming && turn.answer && (
        <div className={styles.streaming}>
          <Markdown text={turn.answer} onCite={onCite} />
        </div>
      )}

      {finished && <Markdown text={finished} onCite={onCite} />}

      {extractive && (
        <>
          <ol className={styles.quotes}>
            {extractive.sentences.map((sentence, index) => (
              <li key={`${index}-${sentence.n}`}>
                {sentence.only && (
                  <span
                    className={`chip tiny flat ${styles.only}`}
                    title="The manual says this for that revision only"
                  >
                    Only {sentence.only}
                  </span>
                )}
                <blockquote>{sentence.text}</blockquote>
                <button
                  type="button"
                  className="cite"
                  onClick={() => onCite(sentence.n)}
                  aria-label={`Show passage ${sentence.n}`}
                >
                  {sentence.n}
                </button>
              </li>
            ))}
          </ol>
          <p className="small muted">{extractive.label}</p>
        </>
      )}

      {done && status && StatusIcon && (
        <p className={styles.status} data-tone={status.tone}>
          <StatusIcon size={16} aria-hidden />
          <span>
            {statusText(done.status, done.model, done.revision)}
            {done.status === "unavailable" && done.generation?.error && (
              <span className={styles.detail}> ({done.generation.error})</span>
            )}
          </span>
        </p>
      )}

      {turn.retrieval?.weak && done && done.status !== "no_passages" && (
        <p className={styles.status} data-tone="warn">
          <TriangleAlert size={16} aria-hidden />
          <span>
            No passage contains the words of this question. The ones below are
            only the nearest in meaning and may not be related.
          </span>
        </p>
      )}
    </section>
  );
}
