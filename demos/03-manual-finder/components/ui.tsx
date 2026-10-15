"use client";

import {
  CircleAlert,
  Info,
  LoaderCircle,
  Microchip,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { highlight, tableCells } from "@/lib/text";
import type { ModelRef, UnitKind } from "@/lib/types";
import { useFinder } from "./finder-provider";

/** The head of every page: an eyebrow, an embossed title, a lead line. */
export function PageHead({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children && <p className="lead">{children}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row muted small" role="status">
      <LoaderCircle size={16} className="spin" aria-hidden />
      {label}
    </span>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad" | "ok";
  children: ReactNode;
}) {
  const Icon =
    tone === "bad" ? CircleAlert : tone === "warn" ? TriangleAlert : Info;
  return (
    <div
      className={`alert ${tone}`}
      role={tone === "bad" ? "alert" : undefined}
    >
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** A model's short name as a chip, e.g. "3B+". ``other`` marks a model that
 * is not the one being worked on (its passage is set aside). */
export function ModelChip({
  model,
  other = false,
  title,
}: {
  model: ModelRef | { id: string; short: string; name: string };
  other?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`chip tiny ${other ? "other" : "flat"}`}
      title={title ?? model.name}
    >
      <Microchip size={12} aria-hidden />
      {model.short}
    </span>
  );
}

/** The chips for a passage's models: "Every model" when it is shared. */
export function ModelTags({
  models,
  other = false,
}: {
  models: string[] | null;
  other?: boolean;
}) {
  const { modelById } = useFinder();
  if (models === null)
    return (
      <span
        className="chip tiny flat"
        title="This passage applies to every model its manual covers"
      >
        Shared
      </span>
    );
  return (
    <span className="tag-row">
      {models.map((id) => {
        const model = modelById(id);
        return (
          <ModelChip
            key={id}
            other={other}
            model={model ?? { id, short: id, name: id }}
          />
        );
      })}
    </span>
  );
}

/** Text with the query's matched terms marked. */
export function Highlighted({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) {
  return (
    <>
      {highlight(text, terms).map((segment, index) =>
        segment.hit ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * One passage of a manual, drawn for what it is: a table row (or rows) as a
 * small table under its header, a list as lines, anything else as text.
 */
export function PassageText({
  text,
  header,
  kind,
  terms = [],
}: {
  text: string;
  header: string | null;
  kind: UnitKind;
  terms?: string[];
}) {
  const table = kind === "row" ? tableCells(text, header) : null;
  if (table)
    return (
      <div className="table-wrap passage-table">
        <table className="table">
          {table.header && (
            <thead>
              <tr>
                {table.header.map((cell, i) => (
                  <th key={i}>{cell}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i}>
                    <Highlighted text={cell} terms={terms} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (kind === "code")
    return (
      <pre className="passage-code">
        <code>{text}</code>
      </pre>
    );
  return (
    <p className="passage-text">
      {text.split("\n").map((line, i) => (
        <span key={i} className="passage-line">
          <Highlighted text={line} terms={terms} />
        </span>
      ))}
    </p>
  );
}
