"use client";

import { Check, CircleHelp } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import type {
  Candidate,
  Clarification,
  ClarifyReason,
  Mention,
} from "@/lib/types";
import { questionForChoice } from "./shared";
import styles from "./clarify-card.module.css";

const EYEBROW: Record<ClarifyReason, string> = {
  no_model: "Which model?",
  ambiguous_name: "More than one model fits",
  conflict: "Two models named",
  revision: "Which revision?",
};

/**
 * Finder asks before it answers: the backend's question and the choices,
 * nothing else. What each manual says is never previewed, so a choice is
 * made by the model in front of the reader, not by the answer they'd prefer.
 * Each choice comes back with the question to ask for it (see
 * questionForChoice).
 */
export function ClarifyCard({
  clarification,
  mentions = [],
  onChooseModel,
  onChooseRevision,
  level = 2,
}: {
  clarification: Clarification;
  /** The model names Finder found in the question. */
  mentions?: Mention[];
  onChooseModel: (modelId: string, question: string) => void;
  onChooseRevision: (
    modelId: string,
    revisionId: string,
    question: string,
  ) => void;
  /** The heading level the card's question takes. */
  level?: 2 | 3 | 4;
}) {
  const titleId = useId();
  const Heading = `h${level}` as const;
  // Models whose manuals match the question come first, in the backend's order.
  const ordered = [
    ...clarification.candidates.filter((c) => c.matched),
    ...clarification.candidates.filter((c) => !c.matched),
  ];
  const revision = clarification.reason === "revision";

  const choose = (candidate: Candidate) => {
    const question = questionForChoice(clarification, mentions, candidate);
    if (candidate.kind === "revision" && candidate.modelId)
      onChooseRevision(candidate.modelId, candidate.id, question);
    else onChooseModel(candidate.id, question);
  };

  return (
    <section
      className={`panel panel-lg ${styles.card}`}
      aria-labelledby={titleId}
    >
      <span className="eyebrow">{EYEBROW[clarification.reason]}</span>
      <Heading id={titleId} className={styles.title}>
        {clarification.message}
      </Heading>
      <p className="muted small">
        {revision
          ? "Choose the revision of the one in front of you. The answer comes from that revision's passages."
          : "Choose one and Finder answers from that model's manual only."}
      </p>
      <ul
        className={styles.choices}
        aria-label={revision ? "Revisions" : "Models"}
      >
        {ordered.map((candidate) => {
          const shortOnly =
            candidate.kind === "revision" || candidate.short === candidate.name;
          return (
            <li
              key={`${candidate.kind}-${candidate.modelId ?? ""}-${candidate.id}`}
            >
              <button
                type="button"
                className={`chip ${styles.choice}`}
                onClick={() => choose(candidate)}
              >
                <span className={`mono ${styles.short}`}>
                  {candidate.short}
                </span>
                {!shortOnly && (
                  <span className={styles.name}>{candidate.name}</span>
                )}
                {candidate.matched && (
                  <span className={styles.matched}>
                    <Check size={13} aria-hidden />
                    {candidate.kind === "revision"
                      ? "in the passages found"
                      : "matches your question"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Link href="/models" className={`btn quiet small ${styles.help}`}>
        <CircleHelp size={15} aria-hidden /> Which model do I have?
      </Link>
    </section>
  );
}
