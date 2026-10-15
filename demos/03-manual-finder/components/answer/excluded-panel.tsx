"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import type { Excluded, UnitKind } from "@/lib/types";
import { useFinder } from "../finder-provider";
import { ModelChip, PassageText } from "../ui";
import styles from "./excluded-panel.module.css";

/** A set-aside passage arrives as plain text; a table row starts with its header line. */
function asPassage(text: string): { header: string | null; kind: UnitKind } {
  const [first, ...rest] = text.split("\n");
  return rest.length && first.includes(" | ")
    ? { header: first, kind: "row" }
    : { header: null, kind: "paragraph" };
}

/**
 * What would have matched in other models' manuals. Finder filters before
 * it ranks, so none of these reached the answer; they are listed, greyed,
 * only so nothing is hidden.
 */
export function ExcludedPanel({
  excluded,
  level = 2,
}: {
  excluded: Excluded;
  level?: 2 | 3 | 4 | 5;
}) {
  const { health } = useFinder();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const listId = useId();
  if (!excluded.items.length) return null;
  const Heading = `h${level}` as const;
  const count = Math.max(excluded.count, excluded.items.length);
  const capped = health ? count >= health.retrieval.candidates : false;
  const one = count === 1 && !capped;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.head}>
        <EyeOff size={18} aria-hidden className={styles.icon} />
        <div className={styles.text}>
          <Heading id={titleId} className={styles.title}>
            {one
              ? "1 passage from another model also matched."
              : `${capped ? `${count} or more` : count} passages from other models also matched.`}
          </Heading>
          <p className="small muted">
            {one ? "It was" : "They were"} left out before the answer was
            written.
            {excluded.items.length < count &&
              ` The closest ${excluded.items.length} are listed here.`}
          </p>
        </div>
        <button
          type="button"
          className="chip"
          aria-pressed={open}
          aria-controls={listId}
          onClick={() => setOpen((shown) => !shown)}
        >
          <Eye size={14} aria-hidden /> Show {one ? "it" : "them"}
        </button>
      </div>
      <ol id={listId} className={styles.list} hidden={!open}>
        {excluded.items.map((item) => (
          <li key={item.id} className="unit masked">
            <div className={styles.itemHead}>
              <span className="tag-row">
                {item.models.map((model) => (
                  <ModelChip key={model.id} model={model} other />
                ))}
              </span>
              <span className={styles.where}>
                {item.docName} › {item.title} ·{" "}
                <span className="mono">{item.location}</span>
              </span>
            </div>
            <div className="unit-text">
              <PassageText text={item.text} {...asPassage(item.text)} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
