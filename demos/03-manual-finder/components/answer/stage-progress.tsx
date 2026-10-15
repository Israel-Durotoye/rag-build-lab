"use client";

import type { Stage, Turn } from "@/lib/types";
import styles from "./stage-progress.module.css";

const STAGES: Stage[] = ["identify", "retrieval", "context", "generation"];

/** What one stage is doing, in plain words. */
export function stageLabel(
  stage: Stage,
  model: string | null,
  generation: boolean,
): string {
  switch (stage) {
    case "identify":
      return "Reading the question";
    case "retrieval":
      return model
        ? `Searching the ${model} passages`
        : "Searching the passages";
    case "context":
      return "Gathering the sections";
    case "generation":
      return generation ? "Writing the answer" : "Quoting the manual";
  }
}

/**
 * The four steps of one question, drawn as indicator lights: lit once done,
 * pulsing while running. The answer's live region announces the same steps.
 */
export function StageProgress({
  turn,
  model,
  generation,
}: {
  turn: Turn;
  /** The short name of the model being searched, once known. */
  model: string | null;
  /** Whether a model writes answers on this server. */
  generation: boolean;
}) {
  const at = turn.stage ? STAGES.indexOf(turn.stage) : -1;
  return (
    <div className={styles.frame}>
      <ol className={styles.stages} aria-label="Progress">
        {STAGES.map((stage, index) => {
          const state = index < at ? "done" : index === at ? "current" : "todo";
          return (
            <li key={stage} className={styles.stage} data-state={state}>
              <span className={styles.led} aria-hidden />
              <span className={styles.label}>
                {stageLabel(stage, model, generation)}
              </span>
              <span className="sr-only">
                {state === "done"
                  ? " (done)"
                  : state === "current"
                    ? " (in progress)"
                    : " (waiting)"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
