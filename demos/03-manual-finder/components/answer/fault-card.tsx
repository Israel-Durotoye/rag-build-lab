"use client";

import { ArrowDownToLine, Columns2, MapPin, Microchip } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import type { FaultCard as Card, ModelRef, Turn } from "@/lib/types";
import { CodeDisplay } from "../code-display";
import { Alert, ModelChip, PassageText } from "../ui";
import { askable, withCode, type CardMark } from "./shared";
import styles from "./fault-card.module.css";

const SCHEME: Record<string, string> = {
  flash: "LED flash pattern",
  gpio: "GPIO pin",
  hex: "Hex value",
  exit: "Exit status",
  filter: "Filter",
  prefixed: "Code",
  token: "Code",
};

const MARK: Record<CardMark, { text: string; tone: string }> = {
  same: { text: "Same meaning in both manuals", tone: "accent" },
  differs: { text: "Means something else here", tone: "warn" },
  only: { text: "Only in this manual", tone: "warn" },
};

function Models({
  label,
  models,
  onCompare,
}: {
  label: string;
  models: ModelRef[];
  onCompare?: (modelId: string) => void;
}) {
  if (!models.length) return null;
  return (
    <div className={styles.line}>
      <span className={styles.lineLabel}>{label}</span>
      <span className="tag-row">
        {models.map((model) =>
          onCompare ? (
            <button
              key={model.id}
              type="button"
              className="chip tiny"
              title={`Ask the same question for the ${model.name}, side by side`}
              onClick={() => onCompare(model.id)}
            >
              <Microchip size={12} aria-hidden />
              {model.short}
              <span className="sr-only">: compare side by side</span>
            </button>
          ) : (
            <ModelChip key={model.id} model={model} />
          ),
        )}
      </span>
    </div>
  );
}

/**
 * The fault card: a code's meaning read straight from the chosen model's
 * own code table, with where it is and which other models' manuals give it
 * the same or another meaning. No model writes any of it. A code the
 * manual doesn't have gets a card that says so, with the nearest codes it
 * does have.
 */
export function FaultCard({
  card,
  turn,
  level = 2,
  mark = null,
  onCite,
  onRetry,
  onCompare,
}: {
  card: Card;
  turn: Turn;
  level?: 2 | 3 | 4;
  /** Set in "Same question, other model": how this card stands against the other side's. */
  mark?: CardMark | null;
  onCite?: (n: number) => void;
  /** Ask again with a corrected question ("Did you mean …"). */
  onRetry?: (question: string) => void;
  /** Ask the same question for another model, side by side. */
  onCompare?: (modelId: string) => void;
}) {
  const titleId = useId();
  const Heading = `h${level}` as const;
  const kind = SCHEME[card.scheme] ?? "Code";
  let body: ReactNode;

  if (card.kind === "found") {
    const item = turn.context?.items.find((i) =>
      i.matchedChunkIds.includes(card.chunkId),
    );
    const section = item?.title ?? turn.retrieval?.chunks[card.chunkId]?.title;
    body = (
      <>
        <div className={styles.head}>
          <span className="eyebrow">
            {card.header ? "From the manual's code table" : "From the manual"}
          </span>
          {mark && (
            <span className={`chip tiny ${MARK[mark].tone}`}>
              {MARK[mark].text}
            </span>
          )}
        </div>
        <Heading id={titleId} className={styles.title}>
          {card.display} on the {card.model.name}
          {card.revision ? ` (${card.revision.label})` : ""}
        </Heading>
        <PassageText
          text={card.meaning}
          header={card.header}
          kind={card.header ? "row" : "paragraph"}
        />
        <p className={styles.where}>
          <MapPin size={14} aria-hidden />
          <span>
            {card.docName}
            {section ? ` › ${section}` : ""}
            {" · "}
            <span className="mono">{card.location}</span>
          </span>
          {item && onCite && (
            <button
              type="button"
              className="btn quiet small"
              onClick={() => onCite(item.n)}
            >
              <ArrowDownToLine size={14} aria-hidden /> Passage {item.n}
            </button>
          )}
        </p>
        {card.unconfirmed && (
          <Alert tone="warn">
            This manual&rsquo;s models aren&rsquo;t confirmed yet, so it counts
            for every model.{" "}
            <Link href={`/library/${encodeURIComponent(card.docId)}#models`}>
              Confirm them
            </Link>
            .
          </Alert>
        )}
        <Models label="Same meaning in" models={card.sameIn} />
        <Models
          label="Means something else in"
          models={card.differsIn}
          onCompare={onCompare}
        />
      </>
    );
  } else {
    const written = turn.identify?.codes.find((c) => c.code === card.code)?.raw;
    body = (
      <>
        <div className={styles.head}>
          <span className="eyebrow">Not in this manual</span>
        </div>
        <Heading id={titleId} className={styles.title}>
          {card.display} isn&rsquo;t in the {card.model.name}
          {card.revision ? ` (${card.revision.label})` : ""} manual
        </Heading>
        {card.didYouMean.length > 0 && (
          <div className={styles.line}>
            <span className={styles.lineLabel}>Did you mean</span>
            <span className="tag-row">
              {card.didYouMean.map((near) =>
                onRetry ? (
                  <button
                    key={near.code}
                    type="button"
                    className={`chip ${styles.near}`}
                    title={`Ask again with ${near.display}`}
                    onClick={() =>
                      onRetry(
                        withCode(
                          turn.question,
                          [written ?? "", card.display],
                          askable(near.display, card.scheme),
                        ),
                      )
                    }
                  >
                    {near.display}
                  </button>
                ) : (
                  <span key={near.code} className={`chip flat ${styles.near}`}>
                    {near.display}
                  </span>
                ),
              )}
            </span>
          </div>
        )}
        <Models
          label="It is in:"
          models={card.elsewhere}
          onCompare={onCompare}
        />
        {card.elsewhere.length === 0 && (
          <p className="small muted">
            No other model&rsquo;s manual in the library has it either.
          </p>
        )}
        {card.elsewhere.length > 0 && onCompare && (
          <p className={`small muted ${styles.hint}`}>
            <Columns2 size={14} aria-hidden /> Choose a model to see its answer
            beside this one.
          </p>
        )}
      </>
    );
  }

  return (
    <section
      className={`panel ${styles.card}${card.kind === "not_found" ? ` ${styles.missing}` : ""}`}
      aria-labelledby={titleId}
    >
      <div className={styles.screen}>
        <CodeDisplay
          code={card.code}
          display={card.display}
          scheme={card.scheme}
          missing={card.kind === "not_found"}
        />
        <span className={styles.kind}>{kind}</span>
      </div>
      <div className={styles.body}>{body}</div>
    </section>
  );
}
