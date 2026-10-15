"use client";

import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import type { SafetyNote } from "@/lib/types";
import styles from "./safety-notes.module.css";

/**
 * The manual's own warnings that bear on the question, quoted word for word
 * with the passage each comes from. They are picked by rule and shown
 * whatever the written answer says.
 */
export function SafetyNotes({
  notes,
  onCite,
  level = 2,
}: {
  notes: SafetyNote[];
  onCite: (n: number) => void;
  level?: 2 | 3 | 4 | 5;
}) {
  const titleId = useId();
  if (!notes.length) return null;
  const Heading = `h${level}` as const;
  return (
    <section className={styles.notes} aria-labelledby={titleId}>
      <div className={styles.head}>
        <ShieldAlert size={18} aria-hidden />
        <Heading id={titleId} className={styles.title}>
          From the manual
        </Heading>
        <span className={styles.sub}>Warnings in these passages</span>
      </div>
      <ul className={styles.list}>
        {notes.map((note) => (
          <li key={`${note.n}-${note.text}`}>
            {note.only && (
              <span
                className={`chip tiny flat ${styles.only}`}
                title="The manual says this for that revision only"
              >
                Only {note.only}
              </span>
            )}
            <blockquote>{note.text}</blockquote>
            <button
              type="button"
              className="cite"
              onClick={() => onCite(note.n)}
              aria-label={`Show passage ${note.n}`}
            >
              {note.n}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
