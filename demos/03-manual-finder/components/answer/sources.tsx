"use client";

import { ChevronDown, ExternalLink, Eye } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { plural, tableCells, webUrl } from "@/lib/text";
import type { ContextItem, ContextUnit, FilterInfo, Turn } from "@/lib/types";
import { useFinder } from "../finder-provider";
import { Highlighted, ModelTags, PassageText } from "../ui";
import { sourceId, type ItemPresence, type SideDiff } from "./shared";
import styles from "./sources.module.css";

type Level = 2 | 3 | 4 | 5;

const PRESENCE: Record<ItemPresence, { text: string; tone: string }> = {
  same: { text: "Same in both manuals", tone: "accent" },
  only: { text: "Only in this manual", tone: "warn" },
  partly: { text: "Partly in both manuals", tone: "flat" },
};

type Block =
  | { type: "unit"; unit: ContextUnit }
  | { type: "table"; header: string; units: ContextUnit[] };

/** Table rows that follow each other under one header are drawn as one table. */
function blocks(units: ContextUnit[]): Block[] {
  const out: Block[] = [];
  for (const unit of units) {
    const last = out[out.length - 1];
    if (unit.kind === "row" && unit.header) {
      if (last?.type === "table" && last.header === unit.header)
        last.units.push(unit);
      else out.push({ type: "table", header: unit.header, units: [unit] });
    } else out.push({ type: "unit", unit });
  }
  return out;
}

function UnitBlock({
  unit,
  terms,
  note,
}: {
  unit: ContextUnit;
  terms: string[];
  note: ReactNode;
}) {
  const state = unit.masked ? " masked" : unit.matched ? " matched" : "";
  return (
    <div className={`unit${state}`}>
      {note}
      <div className="unit-text">
        <PassageText
          text={unit.text}
          header={unit.header}
          kind={unit.kind}
          terms={unit.matched && !unit.masked ? terms : []}
        />
      </div>
    </div>
  );
}

function UnitTable({
  header,
  units,
  terms,
  noteFor,
}: {
  header: string;
  units: ContextUnit[];
  terms: string[];
  noteFor: (unit: ContextUnit) => ReactNode;
}) {
  const head = header.split(" | ").map((cell) => cell.trim());
  const rows = units.map((unit) => ({
    unit,
    note: noteFor(unit),
    cells: tableCells(unit.text, unit.header)?.rows ?? [[unit.text]],
  }));
  const noted = rows.some((row) => row.note);
  return (
    <div className={`table-wrap passage-table ${styles.table}`}>
      <table className="table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
            {noted && (
              <th scope="col">
                <span className="sr-only">Notes</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ unit, note, cells }) =>
            cells.map((row, r) => (
              <tr
                key={`${unit.id}-${r}`}
                className={
                  unit.masked
                    ? styles.masked
                    : unit.matched
                      ? styles.matched
                      : undefined
                }
              >
                {row.map((cell, c) => (
                  <td key={c}>
                    {unit.matched && !unit.masked ? (
                      <Highlighted text={cell} terms={terms} />
                    ) : (
                      cell
                    )}
                  </td>
                ))}
                {noted && (
                  <td className={styles.noteCell}>{r === 0 ? note : null}</td>
                )}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** "Raspberry Pi hardware › Boot": where a section sits, without its own title. */
function crumbs(item: ContextItem): string {
  const path =
    item.path[item.path.length - 1] === item.title
      ? item.path.slice(0, -1)
      : item.path;
  const parts = path[0] === item.docName ? path : [item.docName, ...path];
  return parts.join(" › ");
}

function SourceCard({
  item,
  terms,
  model,
  cited,
  flashing,
  turnId,
  level,
  diff,
}: {
  item: ContextItem;
  terms: string[];
  model: string | null;
  cited: boolean;
  flashing: boolean;
  turnId: string;
  level: Level;
  diff?: SideDiff;
}) {
  const { modelById } = useFinder();
  const [showMasked, setShowMasked] = useState(false);
  const titleId = useId();
  const Heading = `h${level}` as const;
  const chosen = modelById(model);
  const revisionCount = chosen?.revisions.length ?? 0;
  const revisionLabel = (id: string) =>
    chosen?.revisions.find((r) => r.id === id)?.label ?? id;
  const ownModel = (unit: ContextUnit) =>
    model !== null && (unit.models === null || unit.models.includes(model));

  const masked = item.units.filter((u) => u.masked);
  const byRevision = masked.filter(ownModel).length;
  const others =
    byRevision === 0
      ? "other models"
      : byRevision === masked.length
        ? "other revisions"
        : "other models and revisions";
  const visible = showMasked ? item.units : item.units.filter((u) => !u.masked);
  const presence = diff?.items[item.n];

  const noteFor = (unit: ContextUnit): ReactNode => {
    const revisions = model ? (unit.revisions[model] ?? []) : [];
    const parts: ReactNode[] = [];
    if (unit.masked) {
      if (ownModel(unit) && revisions.length)
        parts.push(
          <span
            key="rev"
            className="chip tiny other"
            title="For another revision of this model"
          >
            {revisions.map(revisionLabel).join(", ")}
          </span>,
        );
      else parts.push(<ModelTags key="models" models={unit.models} other />);
    } else {
      if (revisions.length && revisions.length < revisionCount)
        parts.push(
          <span
            key="rev"
            className="chip tiny flat"
            title="This line is for this revision only"
          >
            {revisions.map(revisionLabel).join(", ")} only
          </span>,
        );
      if (presence === "partly" && diff?.only.has(`${item.n}:${unit.id}`))
        parts.push(
          <span key="only" className="chip tiny warn">
            Only in this manual
          </span>,
        );
    }
    return parts.length ? <span className={styles.notes}>{parts}</span> : null;
  };

  return (
    <li>
      <article
        id={sourceId(turnId, item.n)}
        tabIndex={-1}
        className={`panel ${styles.source}`}
        data-flash={flashing || undefined}
        aria-labelledby={titleId}
      >
        <header className={styles.sourceHead}>
          <span className="rank" aria-hidden>
            {item.n}
          </span>
          <div className={styles.sourceTitle}>
            <Heading id={titleId} className={styles.title}>
              <span className="sr-only">Passage {item.n}: </span>
              {item.title}
            </Heading>
            <p className={styles.trail}>
              {crumbs(item)} · <span className="mono">{item.location}</span>
            </p>
          </div>
          <div className={styles.badges}>
            {cited && <span className="chip tiny accent">Cited</span>}
            {item.pinned && (
              <span
                className="chip tiny accent"
                title="Found by looking the code up, not by ranking"
              >
                Exact code match
              </span>
            )}
            {item.unconfirmed && (
              <span
                className="chip tiny warn"
                title="This manual's models aren't confirmed yet, so it counts for every model"
              >
                Models not confirmed
              </span>
            )}
            {item.partial && (
              <span
                className="chip tiny flat"
                title="The section is longer than the word budget, so only the part around the match is here"
              >
                Part of the section
              </span>
            )}
            {presence && (
              <span className={`chip tiny ${PRESENCE[presence].tone}`}>
                {PRESENCE[presence].text}
              </span>
            )}
          </div>
        </header>

        <div className={styles.units}>
          {blocks(visible).map((block) =>
            block.type === "table" ? (
              <UnitTable
                key={`t-${block.units[0].id}`}
                header={block.header}
                units={block.units}
                terms={terms}
                noteFor={noteFor}
              />
            ) : (
              <UnitBlock
                key={block.unit.id}
                unit={block.unit}
                terms={terms}
                note={noteFor(block.unit)}
              />
            ),
          )}
        </div>

        {(masked.length > 0 || item.source) && (
          <footer className={styles.sourceFoot}>
            {masked.length > 0 && (
              <button
                type="button"
                className="chip tiny"
                aria-pressed={showMasked}
                onClick={() => setShowMasked((shown) => !shown)}
                title="Lines of this section that belong to another model or revision. They were never sent to the model."
              >
                <Eye size={13} aria-hidden />
                Show {plural(masked.length, "line")} for {others}
              </button>
            )}
            {item.source && (
              <p className={styles.licence}>
                {item.source.publisher}
                {item.source.licence && webUrl(item.source.licenceUrl) && (
                  <>
                    {" · "}
                    <a
                      href={webUrl(item.source.licenceUrl)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.source.licence}
                    </a>
                  </>
                )}
                {webUrl(item.source.url) && (
                  <>
                    {" · "}
                    <a
                      href={webUrl(item.source.url)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original page
                      <ExternalLink size={12} aria-hidden />
                    </a>
                  </>
                )}
              </p>
            )}
          </footer>
        )}
      </article>
    </li>
  );
}

function filterLine(
  filter: FilterInfo,
  model: string | null,
  revision: string | null,
): string {
  if (!filter.model)
    return `Searched all ${plural(filter.allowed, "passage")}: no model filter applies.`;
  const target = model
    ? `the ${model}${revision ? ` (${revision})` : ""}`
    : "the chosen model";
  const searched = `Searched the ${plural(filter.allowed, "passage")} that apply to ${target}.`;
  if (!filter.excluded) return searched;
  return filter.excluded === 1
    ? `${searched} One passage for another model was set aside before ranking.`
    : `${searched} The ${filter.excluded.toLocaleString("en")} for other models were set aside before ranking.`;
}

/**
 * The numbered passages the model read, each drawn as the chosen model sees
 * its section: the matched lines marked with the question's words, the rest
 * of the section plain, and lines for other models folded away behind a
 * per-passage switch.
 */
export function Sources({
  turn,
  items,
  level = 2,
  collapsible = false,
  open = true,
  onToggle,
  flash = null,
  diff,
}: {
  turn: Turn;
  items: ContextItem[];
  level?: Level;
  /** A chat reply starts with its passages folded. */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** The passage a citation was just followed to. */
  flash?: number | null;
  /** Marks from "Same question, other model". */
  diff?: SideDiff;
}) {
  const { modelById } = useFinder();
  const titleId = useId();
  const listId = useId();
  if (!items.length) return null;
  const Heading = `h${level}` as const;
  const cardLevel = Math.min(level + 1, 5) as Level;
  const terms = turn.retrieval?.keyword.terms ?? [];
  const modelId = turn.done?.model?.id ?? turn.identify?.chosen.model ?? null;
  const model = modelById(modelId);
  const revisionId = turn.done?.revision?.id ?? turn.identify?.chosen.revision;
  const revision =
    turn.done?.revision?.label ??
    model?.revisions.find((r) => r.id === revisionId)?.label ??
    null;
  const cited = new Set(turn.done?.citations.map((c) => c.n) ?? []);
  const filter = turn.retrieval?.filter;

  return (
    <section className={styles.sources} aria-labelledby={titleId}>
      <header className={styles.head}>
        <Heading id={titleId} className={styles.headTitle}>
          Passages <span className={styles.count}>{items.length}</span>
        </Heading>
        {collapsible && (
          <button
            type="button"
            className="btn quiet small"
            aria-expanded={open}
            aria-controls={listId}
            onClick={onToggle}
          >
            <ChevronDown
              size={15}
              aria-hidden
              className={open ? styles.flip : undefined}
            />
            {open ? "Hide the passages" : "Show the passages"}
          </button>
        )}
      </header>
      {filter && (
        <p className={styles.filter}>
          {filterLine(
            filter,
            model?.short ?? turn.done?.model?.short ?? null,
            revision,
          )}
        </p>
      )}
      {open && (
        <ol id={listId} className={styles.list}>
          {items.map((item) => (
            <SourceCard
              key={`${item.n}-${item.id}`}
              item={item}
              terms={terms}
              model={modelId}
              cited={cited.has(item.n)}
              flashing={flash === item.n}
              turnId={turn.id}
              level={cardLevel}
              diff={diff}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
