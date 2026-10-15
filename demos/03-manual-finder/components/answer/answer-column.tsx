"use client";

import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/types";
import { ExcludedPanel } from "./excluded-panel";
import { Explanation } from "./explanation";
import { FaultCard } from "./fault-card";
import { SafetyNotes } from "./safety-notes";
import { revealSource, sourceId, type CardMark, type SideDiff } from "./shared";
import { Sources } from "./sources";
import styles from "./answer-column.module.css";

/**
 * One answer's body, in reading order: the fault card (straight from the
 * manual), the explanation, the manual's warnings, the passages, and what
 * was set aside for other models. A citation scrolls to its passage and
 * lights it up for a moment.
 */
export function AnswerColumn({
  turn,
  level = 2,
  compact = false,
  diff,
  cardMark = null,
  showExcluded = true,
  onRetry,
  onCompare,
}: {
  turn: Turn;
  level?: 2 | 3 | 4;
  /** A chat reply: tighter, with its passages folded until asked for. */
  compact?: boolean;
  /** Marks from "Same question, other model". */
  diff?: SideDiff;
  cardMark?: CardMark | null;
  showExcluded?: boolean;
  /** Ask again with a corrected question ("Did you mean …"). */
  onRetry?: (question: string) => void;
  /** Ask the same question for another model, side by side. */
  onCompare?: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(!compact);
  const [flash, setFlash] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // A citation followed while the passages were folded: shown once they render.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (pending.current === null) return;
    revealSource(sourceId(turn.id, pending.current));
    pending.current = null;
  });

  const cite = (n: number) => {
    setFlash(n);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 1700);
    if (document.getElementById(sourceId(turn.id, n)))
      revealSource(sourceId(turn.id, n));
    else {
      pending.current = n;
      setOpen(true);
    }
  };

  const items = turn.done ? turn.done.sources : (turn.context?.items ?? []);
  const notes = turn.done
    ? turn.done.safetyNotes
    : (turn.context?.safetyNotes ?? []);

  return (
    <div className={`${styles.column}${compact ? ` ${styles.compact}` : ""}`}>
      {turn.card && (
        <FaultCard
          card={turn.card}
          turn={turn}
          level={level}
          mark={cardMark}
          onCite={cite}
          onRetry={onRetry}
          onCompare={onCompare}
        />
      )}
      <Explanation turn={turn} onCite={cite} level={level} />
      <SafetyNotes notes={notes} onCite={cite} level={level} />
      <Sources
        turn={turn}
        items={items}
        level={level}
        collapsible={compact}
        open={open}
        onToggle={() => setOpen((shown) => !shown)}
        flash={flash}
        diff={diff}
      />
      {showExcluded && turn.excluded && (
        <ExcludedPanel excluded={turn.excluded} level={level} />
      )}
    </div>
  );
}
