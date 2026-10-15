"use client";

import { ArrowUp, Check, ExternalLink, Microchip } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getGuide } from "@/lib/api";
import { flashPattern, plural, tableCells, webUrl } from "@/lib/text";
import type {
  GuidePassage,
  Library,
  LibraryModel,
  Lookalike,
  ModelGuide,
  ModelRef,
  Revision,
} from "@/lib/types";
import { CodeDisplay } from "./code-display";
import { errorMessage, useFinder } from "./finder-provider";
import { Alert, ModelChip, PageHead, PassageText, Spinner } from "./ui";
import styles from "./models-view.module.css";

/**
 * "Which model do I have?": the library's models by family, and for the one
 * chosen, how its manuals tell it apart from its look-alikes. Every line is
 * a passage from a manual (backend/guide.py); nothing is drawn or invented.
 */

interface Group {
  id: string;
  name: string;
  models: LibraryModel[];
}

interface Loaded {
  id: string;
  library: Library;
  attempt: number;
  guide: ModelGuide;
}

interface Failed {
  id: string;
  library: Library;
  attempt: number;
  message: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Rows longer than this many lines start folded to the first few. */
const LONG_ROW_LINES = 8;
const FOLDED_ROW_LINES = 5;

const noSubscription = () => () => {};

/** The query string once the page has hydrated; null on the server and in
 * the first client render, so both render the same thing. */
function useQueryString(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => null,
  );
}

/** Keep the chosen model in the address bar, so a guide can be shared. */
function writeModel(id: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set("model", id);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}?${params}`,
  );
}

function cardId(model: string): string {
  return `model-card-${model}`;
}

function smoothly(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

/** Models grouped by family, as the model picker groups them. */
function groupModels(library: Library): Group[] {
  const groups = library.families
    .map((family) => ({
      id: family.id,
      name: family.name,
      models: library.models.filter((m) => m.family === family.id),
    }))
    .filter((group) => group.models.length > 0);
  const loose = library.models.filter(
    (m) => !m.family || !library.families.some((f) => f.id === m.family),
  );
  return loose.length
    ? [...groups, { id: "_other", name: "Other models", models: loose }]
    : groups;
}

/** Names the manuals also use for a model, beyond its name and short name. */
function otherNames(model: {
  name: string;
  short: string;
  aliases: string[];
}): string[] {
  const seen = new Set([model.name.toLowerCase(), model.short.toLowerCase()]);
  const out: string[] = [];
  for (const alias of model.aliases) {
    const folded = alias.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(alias);
  }
  return out;
}

/** "Raspberry Pi 3" → "Raspberry Pi 3 family", so it never reads as a model. */
function familyLabel(name: string): string {
  return /\bfamily$/i.test(name) ? name : `${name} family`;
}

function revisionNames(revision: Revision): string[] {
  const label = revision.label.toLowerCase();
  return revision.aliases.filter((alias) => alias.toLowerCase() !== label);
}

/** "2026-10-15" → "15 October 2026", without time zones getting involved. */
function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

/** A table-row passage starts with its table's header line. */
function headerLine(text: string): string | null {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2 || !lines[0].includes(" | ")) return null;
  return lines[1].split(" | ").length === lines[0].split(" | ").length
    ? lines[0]
    : null;
}

/** How a code is drawn: an LED pattern as its flashes, anything else as text. */
function drawnAs(code: string): string {
  return flashPattern(code) ? "flash" : "text";
}

function Passage({ text }: { text: string }) {
  const header = headerLine(text);
  return (
    <PassageText
      text={text}
      header={header}
      kind={header ? "row" : "paragraph"}
    />
  );
}

/** A code's row as the manual gives it. A very long one (a whole lookup
 * table in one row) starts folded, with the rest a click away. */
function RowText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > LONG_ROW_LINES;
  const shown =
    long && !open ? lines.slice(0, FOLDED_ROW_LINES).join("\n") : text;
  return (
    <div className={styles.rowText}>
      <PassageText
        text={shown}
        header={null}
        kind={text.includes(" | ") ? "row" : "paragraph"}
      />
      {long && (
        <button
          type="button"
          className={`btn small quiet ${styles.more}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show fewer lines" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function Citation({ passage }: { passage: GuidePassage }) {
  return (
    <p className={styles.citation}>
      <cite>{passage.docName}</cite>
      <span>
        <span className="sr-only">, </span>
        {passage.title}
      </span>
      <span className="mono">
        <span className="sr-only">, </span>
        {passage.location}
      </span>
    </p>
  );
}

function CodeLabel({ code, display }: { code: string; display: string }) {
  const scheme = drawnAs(code);
  return (
    <span className={styles.codeStack}>
      <CodeDisplay code={code} display={display} scheme={scheme} size="small" />
      {scheme === "flash" && (
        <span className={styles.codeWords}>{display}</span>
      )}
    </span>
  );
}

function ModelCard({
  model,
  chosen,
  working,
  onChoose,
}: {
  model: LibraryModel;
  chosen: boolean;
  working: boolean;
  onChoose: (id: string) => void;
}) {
  const id = useId();
  const others = otherNames(model);
  return (
    <button
      id={cardId(model.id)}
      type="button"
      className={styles.card}
      aria-pressed={chosen}
      aria-labelledby={`${id}-short ${id}-name`}
      aria-describedby={`${id}-more`}
      onClick={() => onChoose(model.id)}
    >
      <span className={styles.cardTop}>
        <span id={`${id}-short`} className={`lcd small ${styles.cardLcd}`}>
          {model.short}
        </span>
        {working && <span className="chip tiny accent">Working on</span>}
      </span>
      <span id={`${id}-name`} className={styles.cardName}>
        {model.name}
      </span>
      <span id={`${id}-more`} className={styles.cardMore}>
        {working && (
          <span className="sr-only">You are working on this model. </span>
        )}
        {others.length > 0 && (
          <span className={styles.cardAliases}>
            Also called {others.join(", ")}.
          </span>
        )}
        {model.revisions.length > 0 && (
          <span className={styles.cardRevisions}>
            Revisions: {model.revisions.map((r) => r.label).join(", ")}.
          </span>
        )}
        <span className={styles.cardCounts}>
          <span>{plural(model.documents.length, "manual")}</span> ·{" "}
          <span>{plural(model.units, "passage")}</span> ·{" "}
          <span>{plural(model.codes, "code")}</span>
        </span>
      </span>
    </button>
  );
}

function SectionHead({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.sectionHead}>
      <h3 id={id}>{title}</h3>
      {children && <p className="small muted">{children}</p>}
    </div>
  );
}

function CodesTable({
  here,
  there,
  codes,
}: {
  here: ModelRef;
  there: ModelRef;
  codes: Lookalike["codes"];
}) {
  return (
    <div className="table-wrap">
      <table className={`table ${styles.compare}`}>
        <caption className="sr-only">
          Codes that mean something else on the {here.name} and the {there.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">On the {here.short}</th>
            <th scope="col">On the {there.short}</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.code}>
              <th scope="row">
                <CodeLabel code={code.code} display={code.display} />
              </th>
              <td>
                <RowText text={code.here} />
              </td>
              <td>
                <RowText text={code.there} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two rows of the same table, one per model, under the table's own header. */
function FactTable({
  fact,
  here,
  there,
}: {
  fact: Lookalike["facts"][number];
  here: ModelRef;
  there: ModelRef;
}) {
  const sides = [
    {
      model: here,
      passage: fact.here,
      table: tableCells(fact.here.text, fact.header),
    },
    {
      model: there,
      passage: fact.there,
      table: tableCells(fact.there.text, fact.header),
    },
  ];
  const header = sides[0].table?.header ?? sides[1].table?.header ?? null;
  return (
    <figure className={styles.fact}>
      <figcaption className={styles.factTitle}>{fact.title}</figcaption>
      {header ? (
        <div className="table-wrap">
          <table className={`table ${styles.compare}`}>
            <thead>
              <tr>
                <th scope="col">Applies to</th>
                {header.map((cell, i) => (
                  <th key={i} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            {sides.map(({ model, table }) => {
              const rows = table?.rows.length ? table.rows : [[]];
              return (
                <tbody key={model.id}>
                  {rows.map((cells, i) => (
                    <tr key={i}>
                      {i === 0 && (
                        <th
                          scope={rows.length > 1 ? "rowgroup" : "row"}
                          rowSpan={rows.length}
                        >
                          <ModelChip model={model} />
                        </th>
                      )}
                      {cells.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : (
        <div className={styles.sideBySide}>
          {sides.map(({ model, passage }) => (
            <div key={model.id} className={styles.side}>
              <ModelChip model={model} />
              <Passage text={passage.text} />
            </div>
          ))}
        </div>
      )}
      <ul className={styles.factSources}>
        {sides.map(({ model, passage }) => (
          <li key={model.id}>
            <span className={styles.factModel}>{model.short}</span>
            <Citation passage={passage} />
          </li>
        ))}
      </ul>
    </figure>
  );
}

function LookalikeBlock({
  model,
  lookalike,
  onOpen,
}: {
  model: ModelRef;
  lookalike: Lookalike;
  onOpen: (id: string) => void;
}) {
  const id = useId();
  const there = lookalike.model;
  return (
    <article className={`flat ${styles.lookalike}`} aria-labelledby={id}>
      <header className={styles.lookHead}>
        <div className={styles.lookTitle}>
          <span className={`lcd small ${styles.lookLcd}`} aria-hidden="true">
            {there.short}
          </span>
          <h4 id={id}>{there.name}</h4>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => onOpen(there.id)}
        >
          <Microchip size={15} aria-hidden /> Open its guide
        </button>
      </header>

      <div className={styles.lookPart}>
        <h5>Codes that mean something else</h5>
        {lookalike.codes.length > 0 ? (
          <CodesTable here={model} there={there} codes={lookalike.codes} />
        ) : (
          <p className="small muted">
            No code listed for both models has a different meaning.
          </p>
        )}
      </div>

      <div className={styles.lookPart}>
        <h5>Rows that differ</h5>
        {lookalike.facts.length > 0 ? (
          <div className={styles.facts}>
            {lookalike.facts.map((fact) => (
              <FactTable
                key={`${fact.here.chunkId}|${fact.there.chunkId}`}
                fact={fact}
                here={model}
                there={there}
              />
            ))}
          </div>
        ) : (
          <p className="small muted">
            No table in their manuals has a row for each of them that reads
            differently.
          </p>
        )}
      </div>
    </article>
  );
}

function WorkButton({
  label,
  pressed,
  primary = false,
  onClick,
}: {
  label: string;
  pressed: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        primary
          ? `btn primary ${styles.workPrimary}`
          : `btn small ${styles.work}`
      }
      aria-pressed={pressed}
      onClick={onClick}
    >
      {pressed && <Check size={15} aria-hidden />}
      {label}
    </button>
  );
}

function GuideBody({
  guide,
  onOpen,
}: {
  guide: ModelGuide;
  onOpen: (id: string) => void;
}) {
  const id = useId();
  const { model } = guide;
  const ref: ModelRef = { id: model.id, name: model.name, short: model.short };
  return (
    <>
      <section className={styles.section} aria-labelledby={`${id}-identify`}>
        <SectionHead id={`${id}-identify`} title="How to identify it">
          Passages for this model that mention labels, markings, model or
          revision numbers, the processor, or how it differs from others.
        </SectionHead>
        {guide.identification.length > 0 ? (
          <ul className={styles.passages}>
            {guide.identification.map((passage) => (
              <li key={passage.chunkId} className={`well ${styles.passage}`}>
                <Passage text={passage.text} />
                <Citation passage={passage} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No passage in its manuals says how to identify it.
          </p>
        )}
      </section>

      <div className={styles.pair}>
        <section className={styles.section} aria-labelledby={`${id}-revisions`}>
          <SectionHead id={`${id}-revisions`} title="Revisions" />
          {model.revisions.length > 0 ? (
            <ul className={styles.list}>
              {model.revisions.map((revision) => {
                const names = revisionNames(revision);
                return (
                  <li key={revision.id} className={styles.item}>
                    <span className={styles.itemMain}>
                      <strong>{revision.label}</strong>
                      {names.length > 0 && (
                        <span className="small muted">
                          Also written {names.join(", ")}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small muted">
              No revisions are recorded for this model.
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby={`${id}-manuals`}>
          <SectionHead id={`${id}-manuals`} title="Manuals that cover it" />
          {guide.documents.length > 0 ? (
            <ul className={styles.list}>
              {guide.documents.map((doc) => (
                <li key={doc.id} className={styles.item}>
                  <span className={styles.itemMain}>
                    <strong>{doc.name}</strong>
                    {doc.source ? (
                      <span className="small muted">
                        {doc.source.publisher}
                        {doc.source.publisher ? " · " : ""}
                        Licence{" "}
                        {webUrl(doc.source.licenceUrl) ? (
                          <a
                            href={webUrl(doc.source.licenceUrl)!}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {doc.source.licence}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        ) : (
                          doc.source.licence
                        )}
                        {doc.source.retrieved
                          ? ` · retrieved ${formatDay(doc.source.retrieved)}`
                          : ""}
                      </span>
                    ) : (
                      <span className="small muted">
                        Uploaded to this browser&rsquo;s library
                      </span>
                    )}
                  </span>
                  <span className={styles.links}>
                    {webUrl(doc.source?.url) && (
                      <a
                        className="btn small quiet"
                        href={webUrl(doc.source?.url)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} aria-hidden /> Source
                        <span className="sr-only">
                          {" "}
                          of {doc.name} (opens in a new tab)
                        </span>
                      </a>
                    )}
                    <Link
                      className="btn small quiet"
                      href={`/library/${encodeURIComponent(doc.id)}`}
                    >
                      Open in Library
                      <span className="sr-only">: {doc.name}</span>
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">
              No manual in your library covers this model.
            </p>
          )}
        </section>
      </div>

      <section className={styles.section} aria-labelledby={`${id}-lookalikes`}>
        <SectionHead id={`${id}-lookalikes`} title="Look-alikes">
          Models in the same family, or with a short name one or two characters
          away, and where their manuals read differently.
        </SectionHead>
        {guide.lookalikes.length > 0 ? (
          <div className={styles.lookalikes}>
            {guide.lookalikes.map((lookalike) => (
              <LookalikeBlock
                key={lookalike.model.id}
                model={ref}
                lookalike={lookalike}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <p className="small muted">
            No other model in your library shares its family or has a nearly
            identical name.
          </p>
        )}
      </section>
    </>
  );
}

function GuideSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="skeleton" />
      ))}
    </div>
  );
}

function NoModels({ documents }: { documents: number }) {
  const { library, sampleState, sampleError, addSample } = useFinder();
  const offerSample = Boolean(
    library?.sample.available && !library.sample.loaded,
  );
  return (
    <div className="empty">
      <h2>{documents ? "No models yet" : "No manuals yet"}</h2>
      <p>
        {documents
          ? "Your manuals don’t name any models yet. Confirm the models each one covers on the Library page."
          : "Finder compares models using the manuals in your library. Add the sample library or upload a manual to begin."}
      </p>
      <div className={styles.emptyActions}>
        {offerSample && !documents && (
          <button
            type="button"
            className="btn primary"
            disabled={sampleState === "loading"}
            onClick={() => void addSample()}
          >
            {sampleState === "loading"
              ? "Adding the sample library…"
              : "Add the sample library"}
          </button>
        )}
        <Link
          href="/library"
          className={`btn${offerSample && !documents ? "" : " primary"}`}
        >
          Open the Library
        </Link>
      </div>
      {sampleError && <Alert tone="bad">{sampleError}</Alert>}
    </div>
  );
}

export function ModelsView() {
  const {
    health,
    library,
    libraryError,
    refreshLibrary,
    selection,
    setSelection,
  } = useFinder();
  const search = useQueryString();
  const urlModel = useMemo(
    () => (search === null ? null : new URLSearchParams(search).get("model")),
    [search],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [notice, setNotice] = useState<{ model: string; text: string } | null>(
    null,
  );
  const guideRef = useRef<HTMLElement>(null);
  const titleId = useId();

  const chosen = picked ?? urlModel;
  const groups = useMemo(
    () => (library ? groupModels(library) : []),
    [library],
  );
  const chosenModel = chosen
    ? library?.models.find((m) => m.id === chosen)
    : undefined;

  useEffect(() => {
    if (!chosen || !library || !library.models.some((m) => m.id === chosen))
      return;
    let live = true;
    getGuide(chosen)
      .then((guide) => {
        if (live) setLoaded({ id: chosen, library, attempt, guide });
      })
      .catch((cause: unknown) => {
        if (live)
          setFailed({
            id: chosen,
            library,
            attempt,
            message: errorMessage(
              cause,
              "This model’s guide couldn’t be loaded. Try again.",
            ),
          });
      });
    return () => {
      live = false;
    };
  }, [chosen, library, attempt]);

  // After a model is chosen, bring its guide into view and move focus there.
  useEffect(() => {
    if (!scrollRequest) return;
    const guide = guideRef.current;
    if (!guide) return;
    guide.scrollIntoView({ behavior: smoothly(), block: "start" });
    guide.focus({ preventScroll: true });
  }, [scrollRequest]);

  // A link to /models?model=… opens at that model's guide.
  const linked = useRef(false);
  const ready = Boolean(library);
  useEffect(() => {
    if (linked.current || picked || !urlModel || !ready) return;
    linked.current = true;
    guideRef.current?.scrollIntoView({ block: "start" });
  }, [picked, urlModel, ready]);

  // Only a reply to the current request counts; an older one is ignored.
  const current = <T extends { id: string; library: Library; attempt: number }>(
    entry: T | null,
  ) =>
    entry &&
    entry.id === chosen &&
    entry.library === library &&
    entry.attempt === attempt
      ? entry
      : null;
  const guide = current(loaded)?.guide ?? null;
  const failure = current(failed)?.message ?? null;
  const family = chosenModel?.family
    ? library?.families.find((f) => f.id === chosenModel.family)
    : undefined;

  const choose = (id: string) => {
    setPicked(id);
    writeModel(id);
    setScrollRequest((n) => n + 1);
  };

  const backToModels = () => {
    if (!chosen) return;
    const card = document.getElementById(cardId(chosen));
    card?.scrollIntoView({ behavior: smoothly(), block: "center" });
    card?.focus({ preventScroll: true });
  };

  const work = (model: LibraryModel, revision: Revision | null) => {
    setSelection({ model: model.id, revision: revision?.id ?? null });
    setNotice({
      model: model.id,
      text: revision
        ? `You are now working on the ${model.name}, revision ${revision.label}.`
        : `You are now working on the ${model.name}.`,
    });
  };

  let content: ReactNode;
  if (!library) {
    content = !health ? (
      <Alert tone="warn">
        The Finder backend isn&rsquo;t reachable. It may still be starting; this
        page loads as soon as it answers.
      </Alert>
    ) : libraryError ? null : (
      <GuideSkeleton />
    );
  } else if (library.models.length === 0) {
    content = <NoModels documents={library.documents.length} />;
  } else {
    content = (
      <>
        <div className={styles.groups}>
          {groups.map((group) => (
            <section
              key={group.id}
              className={styles.group}
              aria-labelledby={`family-${group.id}`}
            >
              <div className={styles.groupHead}>
                <h2 id={`family-${group.id}`}>{group.name}</h2>
                <span className="small muted">
                  {plural(group.models.length, "model")}
                </span>
              </div>
              <ul className={styles.cards}>
                {group.models.map((model) => (
                  <li key={model.id}>
                    <ModelCard
                      model={model}
                      chosen={model.id === chosen}
                      working={model.id === selection.model}
                      onChoose={choose}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {!chosen && (
          <p className={styles.prompt}>
            Choose a model to see how its manuals tell it apart from its
            look-alikes.
          </p>
        )}

        {chosen && (
          <section
            ref={guideRef}
            tabIndex={-1}
            className={`panel panel-lg ${styles.guide}`}
            aria-labelledby={titleId}
            aria-busy={
              (!guide && !failure && Boolean(chosenModel)) || undefined
            }
          >
            <div className={styles.guideTop}>
              <span className="eyebrow">Guide</span>
              <button
                type="button"
                className="btn small quiet"
                onClick={backToModels}
              >
                <ArrowUp size={15} aria-hidden /> Choose another model
              </button>
            </div>
            {chosenModel ? (
              <>
                <header className={styles.guideHead}>
                  <span className={`lcd ${styles.guideLcd}`} aria-hidden="true">
                    {chosenModel.short}
                  </span>
                  <div className={styles.guideTitle}>
                    <h2 id={titleId}>{chosenModel.name}</h2>
                    <p className={styles.guideMeta}>
                      {family ? `${familyLabel(family.name)} · ` : ""}
                      {plural(chosenModel.documents.length, "manual")} ·{" "}
                      {plural(chosenModel.units, "passage")} ·{" "}
                      {plural(chosenModel.codes, "code")}
                    </p>
                    {otherNames(chosenModel).length > 0 && (
                      <p className={styles.guideAliases}>
                        Also called {otherNames(chosenModel).join(", ")}.
                      </p>
                    )}
                  </div>
                </header>
                <div className={styles.actions}>
                  <WorkButton
                    primary
                    label="Work on this model"
                    pressed={
                      selection.model === chosenModel.id && !selection.revision
                    }
                    onClick={() => work(chosenModel, null)}
                  />
                  {chosenModel.revisions.map((revision) => (
                    <WorkButton
                      key={revision.id}
                      label={`Work on ${revision.label}`}
                      pressed={
                        selection.model === chosenModel.id &&
                        selection.revision === revision.id
                      }
                      onClick={() => work(chosenModel, revision)}
                    />
                  ))}
                </div>
                <p className={styles.notice} aria-live="polite">
                  {notice?.model === chosenModel.id && (
                    <>
                      {notice.text} Searches and answers are filtered to it.{" "}
                      <Link href="/">Search its manuals</Link>
                    </>
                  )}
                </p>
                {failure ? (
                  <Alert tone="bad">
                    <span className={styles.alertBody}>
                      {failure}
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setAttempt((n) => n + 1)}
                      >
                        Try again
                      </button>
                    </span>
                  </Alert>
                ) : guide ? (
                  <GuideBody guide={guide} onOpen={choose} />
                ) : (
                  <>
                    <Spinner label="Reading its manuals…" />
                    <GuideSkeleton />
                  </>
                )}
              </>
            ) : (
              <>
                <h2 id={titleId}>Model not found</h2>
                <p className="muted">
                  &ldquo;{chosen}&rdquo; isn&rsquo;t a model in your library.
                  Choose one of the models above.
                </p>
              </>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Models" title="Which model do I have?">
        Look-alike models are easy to mix up. Choose one to see how its manuals
        say to identify it, its revisions, and the codes and table rows that
        read differently on its look-alikes. Everything here is quoted from the
        manuals; nothing is drawn or generated.
      </PageHead>
      {libraryError && (
        <Alert tone="bad">
          <span className={styles.alertBody}>
            {libraryError}
            <button
              type="button"
              className="btn small"
              onClick={() => void refreshLibrary()}
            >
              Try again
            </button>
          </span>
        </Alert>
      )}
      {content}
    </>
  );
}
