"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  EyeOff,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { unitApplies } from "@/lib/applies";
import { getDocument, saveDocumentModels } from "@/lib/api";
import { formatBytes, plural } from "@/lib/text";
import type {
  DocumentDetail,
  ModelDef,
  Revision,
  Section,
  Unit,
} from "@/lib/types";
import { CodeDisplay } from "./code-display";
import { errorMessage, useFinder } from "./finder-provider";
import { External, FORMAT_LABEL, formatDate, webUrl } from "./library-view";
import { Alert, ModelChip, PageHead, PassageText, Spinner } from "./ui";
import styles from "./document-view.module.css";

/** Sections drawn before "Show more". */
const SECTION_PAGE = 30;
/** Codes listed before "Show all". */
const CODE_PAGE = 40;
/** The backend's reply for a manual this workspace doesn't hold. */
const NOT_FOUND = "Manual not found.";

export { unitApplies };

/** How a passage's models were decided, as a short caption. */
function tagCaption(unit: Unit): string | null {
  switch (unit.tag) {
    case "text":
      return "named in the text";
    case "header":
      return "named in the table header";
    case "heading":
      return "from a heading";
    case "document":
      return "shared by the whole manual";
    case "override":
      // The reason is shown in full under the passage.
      return unit.tagReason ? null : "corrected by hand";
    default:
      return unit.models === null ? "shared by the whole manual" : null;
  }
}

interface View {
  model: string | null;
  revision: string | null;
}

const ALL: View = { model: null, revision: null };

type TargetKind = "unit" | "section" | "models" | "codes";

interface Target {
  kind: TargetKind;
  id: string;
  /** Changes on every request, so asking again scrolls again. */
  nonce: number;
}

/**
 * What an address hash points at: "#models", "#codes", a unit or section ID
 * (optionally prefixed "unit-" or "section-"), or a chunk ID
 * ("<doc>:<unit>:0").
 */
function parseTarget(
  hash: string,
  detail: DocumentDetail,
): Omit<Target, "nonce"> | null {
  let raw: string;
  try {
    raw = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw === "models" || raw === "codes") return { kind: raw, id: raw };
  const parts = raw.split(":");
  const names = [
    raw,
    raw.replace(/^(unit|section)-/, ""),
    parts.length === 3 ? parts[1] : "",
  ];
  for (const name of names) {
    if (!name) continue;
    if (detail.units.some((unit) => unit.id === name))
      return { kind: "unit", id: name };
    if (detail.sections.some((section) => section.id === name))
      return { kind: "section", id: name };
  }
  return null;
}

function domId(target: Omit<Target, "nonce">): string {
  if (target.kind === "unit") return `unit-${target.id}`;
  if (target.kind === "section") return `section-${target.id}`;
  return target.kind;
}

function termsOf(needle: string): string[] {
  return needle.toLowerCase().split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------- page

interface Loaded {
  request: string;
  detail: DocumentDetail | null;
  error: string | null;
  /** The address hash when the manual arrived, to open what it points at. */
  hash: string;
}

/**
 * One manual as Finder searches it: its source and licence, the models it
 * covers (editable for uploads), and every section and passage with the
 * models each applies to. "View as" greys out what a model never sees.
 */
export function DocumentView({ id }: { id: string }) {
  const { health } = useFinder();
  const online = health !== null;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = `${id}\n${attempt}`;

  useEffect(() => {
    if (!online) return;
    let alive = true;
    getDocument(id).then(
      (detail) => {
        if (alive)
          setLoaded({
            request,
            detail,
            error: null,
            hash: window.location.hash,
          });
      },
      (cause: unknown) => {
        if (alive)
          setLoaded({
            request,
            detail: null,
            error: errorMessage(cause, "This manual couldn't be loaded."),
            hash: "",
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [id, online, request]);

  const current = loaded?.request === request ? loaded : null;
  const onSaved = useCallback(
    (detail: DocumentDetail) =>
      setLoaded((previous) => (previous ? { ...previous, detail } : previous)),
    [],
  );

  let body;
  if (current?.detail)
    body = (
      <DocumentBody
        key={current.detail.id}
        detail={current.detail}
        initialHash={current.hash}
        onSaved={onSaved}
      />
    );
  else if (current?.error === NOT_FOUND)
    body = (
      <div className="empty">
        <h2>This manual isn&rsquo;t in this browser&rsquo;s library</h2>
        <p>
          It may have been removed, or added in another browser: each browser
          keeps its own private library.
        </p>
        <Link href="/library" className="btn">
          Go to the library
        </Link>
      </div>
    );
  else if (current?.error)
    body = (
      <div className="stack-sm">
        <Alert tone="bad">{current.error}</Alert>
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  else if (!online)
    body = (
      <Alert tone="warn">
        Finder&rsquo;s backend isn&rsquo;t reachable, so this manual can&rsquo;t
        be shown yet. The page loads it as soon as the backend answers.
      </Alert>
    );
  else
    body = (
      <div className="stack" aria-busy="true">
        <Spinner label="Loading the manual…" />
        <div className="skeleton" style={{ width: "55%", minHeight: 40 }} />
        <div className="skeleton" style={{ width: "80%" }} />
        <div className="skeleton" style={{ minHeight: 160 }} />
      </div>
    );

  return (
    <div className={`stack ${styles.page}`}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link href="/library">
          <ArrowLeft size={16} aria-hidden /> Library
        </Link>
      </nav>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- body

function DocumentBody({
  detail,
  initialHash,
  onSaved,
}: {
  detail: DocumentDetail;
  initialHash: string;
  onSaved: (detail: DocumentDetail) => void;
}) {
  const { selection } = useFinder();
  const sectionsHeading = useId();
  const defsById = useMemo(
    () => new Map(detail.modelDefs.map((def) => [def.id, def])),
    [detail.modelDefs],
  );
  const unitsById = useMemo(
    () => new Map(detail.units.map((unit) => [unit.id, unit])),
    [detail.units],
  );
  const sectionIndex = useMemo(
    () => new Map(detail.sections.map((section, i) => [section.id, i])),
    [detail.sections],
  );
  const haystacks = useMemo(
    () =>
      new Map(
        detail.sections.map((section) => [
          section.id,
          [
            ...section.path,
            section.title,
            ...section.unitIds.map((id) => unitsById.get(id)?.text ?? ""),
          ]
            .join("\n")
            .toLowerCase(),
        ]),
      ),
    [detail.sections, unitsById],
  );

  // What the address pointed at when the page opened.
  const [initial] = useState(() => {
    const target = parseTarget(initialHash, detail);
    const sectionId =
      target?.kind === "unit"
        ? detail.units.find((unit) => unit.id === target.id)?.sectionId
        : target?.kind === "section"
          ? target.id
          : undefined;
    const index = sectionId
      ? detail.sections.findIndex((section) => section.id === sectionId)
      : -1;
    return {
      target: target ? { ...target, nonce: 0 } : null,
      open: new Set(sectionId ? [sectionId] : []),
      limit: Math.max(SECTION_PAGE, index + 1),
    };
  });
  const [target, setTarget] = useState<Target | null>(initial.target);
  const [open, setOpen] = useState<Set<string>>(initial.open);
  const [limit, setLimit] = useState(initial.limit);
  const [needle, setNeedle] = useState("");
  // undefined: follow the model chosen in the picker ("Working on").
  const [choice, setChoice] = useState<View | undefined>(undefined);

  // ------------------------------------------------------------ view as
  const valid = (view: View | null | undefined): View | null => {
    if (!view) return null;
    if (view.model === null) return ALL;
    const def = defsById.get(view.model);
    if (!def) return null;
    const revision = def.revisions.some((r) => r.id === view.revision)
      ? view.revision
      : null;
    return { model: def.id, revision };
  };
  const chosen = valid(choice);
  const picked = valid(selection.model ? selection : null);
  const view = chosen ?? picked ?? ALL;
  const following = !chosen && picked !== null;
  const viewDef = view.model ? defsById.get(view.model) : undefined;
  const viewRevision = viewDef?.revisions.find((r) => r.id === view.revision);
  const viewShort = viewDef
    ? `${viewDef.short}${viewRevision ? ` ${viewRevision.label}` : ""}`
    : "";
  const viewModel = view.model;
  const applying = viewModel
    ? detail.units.filter((unit) =>
        unitApplies(unit, detail.models, viewModel, view.revision),
      ).length
    : detail.units.length;

  // ------------------------------------------------------------ sections
  const terms = termsOf(needle);
  const matching = (value: string) => {
    const words = termsOf(value);
    return detail.sections.filter((section) => {
      const text = haystacks.get(section.id) ?? "";
      return words.every((word) => text.includes(word));
    });
  };
  const matches = terms.length ? matching(needle) : detail.sections;
  const shown = terms.length ? matches : detail.sections.slice(0, limit);

  const find = (value: string) => {
    setNeedle(value);
    if (termsOf(value).length)
      setOpen(
        new Set(
          matching(value)
            .slice(0, SECTION_PAGE)
            .map((section) => section.id),
        ),
      );
  };

  const toggle = useCallback((sectionId: string, isOpen: boolean) => {
    setOpen((current) => {
      if (current.has(sectionId) === isOpen) return current;
      const next = new Set(current);
      if (isOpen) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  /** Open what a target sits in, then scroll to it. */
  const reveal = useCallback(
    (kind: TargetKind, targetId: string) => {
      const sectionId =
        kind === "unit"
          ? unitsById.get(targetId)?.sectionId
          : kind === "section"
            ? targetId
            : undefined;
      if (sectionId !== undefined) {
        const index = sectionIndex.get(sectionId) ?? 0;
        setNeedle("");
        setLimit((current) => Math.max(current, index + 1));
        setOpen((current) =>
          current.has(sectionId) ? current : new Set(current).add(sectionId),
        );
      }
      setTarget((current) => ({
        kind,
        id: targetId,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    },
    [sectionIndex, unitsById],
  );

  const showUnit = (unitId: string) => {
    reveal("unit", unitId);
    window.history.replaceState(null, "", `#unit-${unitId}`);
  };

  // Links within the page ("#codes", "#unit-…") open what they point at.
  useEffect(() => {
    const onHash = () => {
      const next = parseTarget(window.location.hash, detail);
      if (next) reveal(next.kind, next.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [detail, reveal]);

  useEffect(() => {
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(domId(target));
      if (!element) return;
      const still = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      element.scrollIntoView({
        behavior: still ? "auto" : "smooth",
        block: "start",
      });
      if (target.kind === "unit") element.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  const targetUnit = target?.kind === "unit" ? target.id : null;

  return (
    <>
      <DocumentHead detail={detail} />
      <ModelsPanel detail={detail} onSaved={onSaved} />
      <ViewBar
        defs={detail.modelDefs}
        view={view}
        following={following}
        applying={applying}
        total={detail.units.length}
        onChoose={setChoice}
      />

      <section
        className={`panel ${styles.sectionsPanel}`}
        aria-labelledby={sectionsHeading}
      >
        <div className={styles.panelHead}>
          <h2 id={sectionsHeading}>Sections</h2>
          <span className="muted small">
            {plural(detail.sections.length, "section")} ·{" "}
            {plural(detail.units.length, "passage")}
          </span>
        </div>
        <div className={styles.toolbar}>
          <label className={`field ${styles.find}`}>
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={needle}
              onChange={(event) => find(event.target.value)}
              placeholder="Find in this manual"
              aria-label="Find in this manual"
              autoComplete="off"
            />
          </label>
          <div className={styles.toolbarButtons}>
            <button
              type="button"
              className="btn small quiet"
              disabled={!shown.length}
              onClick={() =>
                setOpen(new Set(shown.map((section) => section.id)))
              }
            >
              Open all
            </button>
            <button
              type="button"
              className="btn small quiet"
              disabled={!open.size}
              onClick={() => setOpen(new Set())}
            >
              Close all
            </button>
          </div>
        </div>
        <p className="small muted" aria-live="polite">
          {terms.length
            ? matches.length
              ? `${plural(matches.length, "section")} contain “${needle.trim()}”.`
              : `No section contains “${needle.trim()}”.`
            : shown.length < detail.sections.length
              ? `Showing ${shown.length} of ${detail.sections.length} sections.`
              : ""}
        </p>
        {shown.length > 0 && (
          <div className={styles.sectionList}>
            {shown.map((section) => (
              <SectionBlock
                key={section.id}
                section={section}
                units={section.unitIds.flatMap((unitId) => {
                  const unit = unitsById.get(unitId);
                  return unit ? [unit] : [];
                })}
                open={open.has(section.id)}
                onToggle={toggle}
                view={view}
                viewShort={viewShort}
                terms={terms}
                targetUnit={targetUnit}
                defsById={defsById}
                documentModels={detail.models}
              />
            ))}
          </div>
        )}
        {!terms.length && detail.sections.length > shown.length && (
          <button
            type="button"
            className={`btn ${styles.more}`}
            onClick={() => setLimit(detail.sections.length)}
          >
            Show more: the other{" "}
            {plural(detail.sections.length - shown.length, "section")}
          </button>
        )}
      </section>

      <CodesPanel
        detail={detail}
        unitsById={unitsById}
        view={view}
        viewShort={viewShort}
        defsById={defsById}
        onShow={showUnit}
      />
    </>
  );
}

// ---------------------------------------------------------------- head

function DocumentHead({ detail }: { detail: DocumentDetail }) {
  const { health } = useFinder();
  const source = detail.source;
  const pageUrl = webUrl(source?.url);
  const sourceUrl = webUrl(source?.source);
  const licenceUrl = webUrl(source?.licenceUrl);
  const extraction = detail.extraction;
  const semanticStatus = health?.embeddings.status;
  const semanticOn = semanticStatus === "ready" || semanticStatus === "loading";

  return (
    <>
      <PageHead
        eyebrow={
          detail.sample
            ? "Sample manual"
            : `${FORMAT_LABEL[detail.format]} upload`
        }
        title={<span className={styles.docTitle}>{detail.name}</span>}
        aside={
          <dl className={styles.counts}>
            <div>
              <dt>Sections</dt>
              <dd>{detail.sections.length.toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Passages</dt>
              <dd>{detail.units.length.toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Codes</dt>
              <dd>{detail.codeEntries.length.toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Words</dt>
              <dd>{detail.words.toLocaleString("en")}</dd>
            </div>
          </dl>
        }
      >
        Shown as Finder searches it: its sections, the passages in them, and the
        models each passage applies to.
      </PageHead>

      <section
        className={`panel ${styles.factsPanel}`}
        aria-label="About this manual"
      >
        <dl className={styles.facts}>
          {source?.publisher && (
            <>
              <dt>Publisher</dt>
              <dd>{source.publisher}</dd>
            </>
          )}
          <dt>{detail.sample ? "Version" : "File fingerprint"}</dt>
          <dd className="mono">{detail.version}</dd>
          {pageUrl && (
            <>
              <dt>Published page</dt>
              <dd>
                <External href={pageUrl}>
                  {pageUrl.replace(/^https?:\/\//, "")}
                </External>
              </dd>
            </>
          )}
          {sourceUrl && (
            <>
              <dt>Source files</dt>
              <dd>
                <External href={sourceUrl}>
                  {sourceUrl.replace(/^https?:\/\//, "")}
                </External>
              </dd>
            </>
          )}
          {source?.licence && (
            <>
              <dt>Licence</dt>
              <dd>
                {licenceUrl ? (
                  <External href={licenceUrl}>{source.licence}</External>
                ) : (
                  source.licence
                )}
              </dd>
            </>
          )}
          {source?.retrieved && (
            <>
              <dt>Retrieved</dt>
              <dd>{formatDate(source.retrieved)}</dd>
            </>
          )}
          {!detail.sample && (
            <>
              <dt>File</dt>
              <dd>
                {FORMAT_LABEL[detail.format]} · {formatBytes(detail.bytes)}
                {extraction && extraction.pageCount > 0
                  ? ` · ${plural(extraction.pageCount, "page")}`
                  : ""}
                {extraction && extraction.ocrPages > 0
                  ? ` · ${plural(extraction.ocrPages, "page")} read with ${extraction.ocrEngine ?? "OCR"}`
                  : ""}
              </dd>
            </>
          )}
          <dt>Added</dt>
          <dd>{formatDate(detail.addedAt)}</dd>
          <dt>Search</dt>
          <dd>
            {detail.embeddings
              ? "Keyword and semantic search"
              : semanticOn
                ? "Keyword search only: this manual has no embeddings"
                : "Keyword search only: semantic search is off on this server"}
          </dd>
        </dl>
        {detail.truncated && (
          <Alert tone="warn">
            Finder kept only part of this file: it went over the limit on
            sections, passages or pages read with OCR.
          </Alert>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- models

function ModelsPanel({
  detail,
  onSaved,
}: {
  detail: DocumentDetail;
  onSaved: (detail: DocumentDetail) => void;
}) {
  const headingId = useId();
  return (
    <section
      id="models"
      className={`panel ${styles.modelsPanel}`}
      aria-labelledby={headingId}
    >
      <div className={styles.panelHead}>
        <h2 id={headingId}>Models this manual covers</h2>
        <span className="muted small">
          {detail.modelDefs.length
            ? plural(detail.modelDefs.length, "model")
            : "None listed"}
        </span>
      </div>
      {detail.sample ? (
        <ModelList detail={detail} />
      ) : (
        <ModelEditor key={detail.id} detail={detail} onSaved={onSaved} />
      )}
    </section>
  );
}

/** The sample library's models, read-only. */
function ModelList({ detail }: { detail: DocumentDetail }) {
  if (!detail.modelDefs.length)
    return (
      <p className="muted">
        No models listed: every passage applies to every model.
      </p>
    );
  return (
    <>
      <p className="muted small">
        The sample library&rsquo;s models are fixed. Finder recognises each by
        the names below, as the publisher writes them.
      </p>
      <ul className={styles.modelGrid}>
        {detail.modelDefs.map((def) => {
          const family = detail.families.find((f) => f.id === def.family);
          const count = detail.units.filter((unit) =>
            unitApplies(unit, detail.models, def.id),
          ).length;
          const others = def.aliases.filter(
            (alias) => alias !== def.name && alias !== def.short,
          );
          return (
            <li key={def.id} className={styles.modelTile}>
              <span className={styles.short}>{def.short}</span>
              <div className={styles.modelText}>
                <strong>{def.name}</strong>
                {family && (
                  <span className="small muted">Family: {family.name}</span>
                )}
                {others.length > 0 && (
                  <span className={styles.aliases}>
                    Also written as {others.join(", ")}
                  </span>
                )}
                {def.revisions.length > 0 && (
                  <span className={styles.revisionRow}>
                    <span className="small muted">Revisions</span>
                    {def.revisions.map((revision) => (
                      <span key={revision.id} className="chip tiny flat">
                        {revision.label}
                      </span>
                    ))}
                  </span>
                )}
                <span className="small">
                  {count.toLocaleString("en")} of{" "}
                  {plural(detail.units.length, "passage")} apply
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface Row {
  key: string;
  /** The saved model's ID; empty for a new row, which the backend names. */
  id: string;
  family: string | null;
  name: string;
  short: string;
  aliases: string;
  revisions: string;
  /** The saved revisions, so a label that stays keeps its ID. */
  known: Revision[];
}

function rowsFrom(defs: ModelDef[]): Row[] {
  return defs.map((def) => ({
    key: `saved-${def.id}`,
    id: def.id,
    family: def.family,
    name: def.name,
    short: def.short,
    aliases: def.aliases.join(", "),
    revisions: def.revisions.map((revision) => revision.label).join(", "),
    known: def.revisions,
  }));
}

/** A comma-separated field as a list: trimmed, no blanks, no repeats. */
function commaList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function blank(row: Row): boolean {
  return ![row.name, row.short, row.aliases, row.revisions].some((value) =>
    value.trim(),
  );
}

/** The rows as the backend takes them. An empty ID or short name is filled
 * in by the backend: an ID from the name, the short name as the name. */
function toModels(rows: Row[]): ModelDef[] {
  return rows
    .filter((row) => !blank(row))
    .map((row) => ({
      id: row.id,
      name: row.name.trim(),
      short: row.short.trim(),
      family: row.family,
      aliases: commaList(row.aliases),
      revisions: commaList(row.revisions).map(
        (label) =>
          row.known.find((revision) => revision.label === label) ?? {
            id: "",
            label,
            aliases: [],
          },
      ),
    }));
}

function ModelRow({
  row,
  number,
  focus,
  onChange,
  onRemove,
}: {
  row: Row;
  number: number;
  focus: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const headingId = useId();
  const name = row.name.trim();
  return (
    <div className={styles.modelRow} role="group" aria-labelledby={headingId}>
      <div className={styles.rowHead}>
        <p id={headingId} className={styles.rowTitle}>
          Model {number}
          {name && <span className="muted">: {name}</span>}
        </p>
        <button
          type="button"
          className="btn icon small quiet"
          onClick={onRemove}
          aria-label={`Remove model ${number}${name ? `, ${name}` : ""}`}
          title="Remove this model"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className={styles.rowGrid}>
        <label className="label">
          Name
          <span className="field">
            <input
              value={row.name}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              autoFocus={focus}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </span>
        </label>
        <label className="label">
          <span>
            Short name <span className="hint">up to 24 characters</span>
          </span>
          <span className="field">
            <input
              value={row.short}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              placeholder="Same as the name"
              onChange={(event) => onChange({ short: event.target.value })}
            />
          </span>
        </label>
        <label className="label">
          <span>
            Other names <span className="hint">comma-separated</span>
          </span>
          <span className="field">
            <input
              value={row.aliases}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ aliases: event.target.value })}
            />
          </span>
        </label>
        <label className="label">
          <span>
            Revisions <span className="hint">comma-separated labels</span>
          </span>
          <span className="field">
            <input
              value={row.revisions}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ revisions: event.target.value })}
            />
          </span>
        </label>
      </div>
    </div>
  );
}

/** An upload's models: rows to edit, names found in the file, and Save,
 * which re-tags every passage on the server. */
function ModelEditor({
  detail,
  onSaved,
}: {
  detail: DocumentDetail;
  onSaved: (detail: DocumentDetail) => void;
}) {
  const { refreshLibrary } = useFinder();
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(detail.modelDefs));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const counter = useRef(0);

  const confirmed = detail.modelsConfirmed;
  const dirty =
    JSON.stringify(toModels(rows)) !==
    JSON.stringify(toModels(rowsFrom(detail.modelDefs)));
  const listed = rows.filter((row) => !blank(row)).length;
  const taken = new Set(
    rows
      .flatMap((row) => [row.name, row.short, ...commaList(row.aliases)])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

  const freshRow = (name = ""): Row => {
    counter.current += 1;
    return {
      key: `new-${counter.current}`,
      id: "",
      family: null,
      name,
      short: "",
      aliases: "",
      revisions: "",
      known: [],
    };
  };

  const edited = () => {
    setNotice(null);
    setError(null);
  };

  const update = (key: string, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    edited();
  };

  const remove = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    edited();
  };

  const addRow = () => {
    const row = freshRow();
    setRows((current) => [...current, row]);
    setFocusKey(row.key);
    edited();
  };

  const addSuggestion = (name: string) => {
    const row = freshRow(name);
    setRows((current) => {
      const empty = current.findIndex(blank);
      if (empty < 0) return [...current, row];
      return current.map((item, index) =>
        index === empty ? { ...item, name } : item,
      );
    });
    edited();
  };

  const discard = () => {
    setRows(rowsFrom(detail.modelDefs));
    edited();
  };

  const save = async () => {
    const unnamed = rows.findIndex((row) => !blank(row) && !row.name.trim());
    if (unnamed >= 0) {
      setError(`Give model ${unnamed + 1} a name, or remove it.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await saveDocumentModels(
        detail.id,
        toModels(rows),
        detail.families,
      );
      setRows(rowsFrom(updated.modelDefs));
      onSaved(updated);
      const tied = updated.units.filter((unit) => unit.models !== null).length;
      setNotice(
        updated.modelDefs.length
          ? `Saved, and every passage tagged again: ${plural(tied, "passage")} tied to particular models, ${plural(updated.units.length - tied, "passage")} shared by the whole manual.`
          : "Saved: this manual lists no models, so every passage applies to every model.",
      );
      await refreshLibrary();
    } catch (cause) {
      setError(errorMessage(cause, "The models couldn't be saved. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = saving
    ? "Saving…"
    : dirty
      ? "Save and re-tag passages"
      : confirmed
        ? "Saved"
        : listed
          ? "Confirm these models"
          : "Confirm: no particular model";

  return (
    <div className={styles.editor}>
      {!confirmed && (
        <Alert tone="warn">
          These models aren&rsquo;t confirmed yet. Until they are, every passage
          applies to every model, so an answer for one model can include
          passages written for another.
        </Alert>
      )}
      <p className="muted small">
        Saving tags every passage again: a passage that names one of these
        models applies to it; a table row applies to the models its header
        names; a passage under a heading that names a model applies to that
        model; the rest are shared by every model listed here.
      </p>

      {rows.length ? (
        <ol className={styles.rows}>
          {rows.map((row, index) => (
            <li key={row.key}>
              <ModelRow
                row={row}
                number={index + 1}
                focus={row.key === focusKey}
                onChange={(patch) => update(row.key, patch)}
                onRemove={() => remove(row.key)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className={`well ${styles.noRows}`}>
          No models listed: every passage applies to every model.
        </p>
      )}

      <div>
        <button type="button" className="btn small" onClick={addRow}>
          <Plus size={15} aria-hidden /> Add a model
        </button>
      </div>

      {detail.suggestedModels.length > 0 && (
        <div className={styles.suggest}>
          <p className="label">Names in this manual that look like models</p>
          <div className="tag-row">
            {detail.suggestedModels.map((suggestion) => {
              const added = taken.has(suggestion.name.toLowerCase());
              return (
                <button
                  key={suggestion.name}
                  type="button"
                  className="chip"
                  disabled={added}
                  onClick={() => addSuggestion(suggestion.name)}
                  title={`Appears ${plural(suggestion.count, "time")}`}
                >
                  {added ? (
                    <Check size={14} aria-hidden />
                  ) : (
                    <Plus size={14} aria-hidden />
                  )}
                  {suggestion.name}
                  <span className={styles.count}>{suggestion.count}</span>
                  <span className="sr-only">
                    {added
                      ? ", already listed"
                      : `, add as a model (appears ${plural(suggestion.count, "time")})`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div aria-live="polite" className={styles.messages}>
        {error && <Alert tone="bad">{error}</Alert>}
        {notice && <Alert tone="ok">{notice}</Alert>}
      </div>

      <div className={styles.editorActions}>
        <button
          type="button"
          className="btn primary"
          disabled={saving || (!dirty && confirmed)}
          onClick={() => void save()}
        >
          {!saving && !dirty && confirmed && <Check size={16} aria-hidden />}
          {saveLabel}
        </button>
        {dirty && !saving && (
          <button type="button" className="btn quiet" onClick={discard}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- view as

function ViewBar({
  defs,
  view,
  following,
  applying,
  total,
  onChoose,
}: {
  defs: ModelDef[];
  view: View;
  following: boolean;
  applying: number;
  total: number;
  onChoose: (view: View) => void;
}) {
  const labelId = useId();
  if (!defs.length)
    return (
      <div className={styles.viewBar}>
        <p className={styles.viewLegend}>
          This manual lists no models, so every passage applies to every model.
        </p>
      </div>
    );
  const model = view.model
    ? defs.find((def) => def.id === view.model)
    : undefined;
  const revision = model?.revisions.find((r) => r.id === view.revision);
  const short = model
    ? `${model.short}${revision ? ` ${revision.label}` : ""}`
    : "";

  return (
    <div className={styles.viewBar} data-sticky={defs.length <= 8 || undefined}>
      <div className={styles.viewRow}>
        <span id={labelId} className="eyebrow">
          View as
        </span>
        <div
          className={`seg ${styles.viewSeg}`}
          role="group"
          aria-labelledby={labelId}
        >
          <button
            type="button"
            aria-pressed={!model}
            onClick={() => onChoose({ model: null, revision: null })}
          >
            All passages
          </button>
          {defs.map((def) => (
            <button
              key={def.id}
              type="button"
              aria-pressed={view.model === def.id}
              title={def.name}
              onClick={() => onChoose({ model: def.id, revision: null })}
            >
              {def.short}
              <span className="sr-only"> ({def.name})</span>
            </button>
          ))}
        </div>
        {model && model.revisions.length > 0 && (
          <div
            className={`seg ${styles.viewSeg}`}
            role="group"
            aria-label={`Revision of the ${model.short}`}
          >
            <button
              type="button"
              aria-pressed={view.revision === null}
              onClick={() => onChoose({ model: model.id, revision: null })}
            >
              Any revision
            </button>
            {model.revisions.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={view.revision === r.id}
                onClick={() => onChoose({ model: model.id, revision: r.id })}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className={styles.viewLegend} aria-live="polite">
        {model ? (
          <>
            Viewing as the <strong>{short}</strong>
            {following ? " (the model you’re working on)" : ""}:{" "}
            {applying.toLocaleString("en")} of {plural(total, "passage")} apply.
            Greyed, hatched passages are written for other models; Finder leaves
            them out when answering for the {short}.
          </>
        ) : (
          <>
            Every passage, with the models it applies to. Choose a model to grey
            out what it never sees.
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- sections

function UnitModels({
  models,
  defsById,
}: {
  models: string[];
  defsById: Map<string, ModelDef>;
}) {
  if (!models.length)
    return <span className="chip tiny flat">No model in this library</span>;
  return (
    <span className="tag-row">
      {models.map((id) => (
        <ModelChip
          key={id}
          model={defsById.get(id) ?? { id, short: id, name: id }}
        />
      ))}
    </span>
  );
}

function revisionLabels(
  unit: Unit,
  defsById: Map<string, ModelDef>,
): { key: string; text: string }[] {
  return Object.entries(unit.revisions ?? {})
    .filter(([, ids]) => ids.length > 0)
    .map(([modelId, ids]) => {
      const def = defsById.get(modelId);
      const labels = ids.map(
        (id) =>
          def?.revisions.find((revision) => revision.id === id)?.label ?? id,
      );
      return {
        key: modelId,
        text: `${def?.short ?? modelId} ${labels.join(", ")}`,
      };
    });
}

function UnitBlock({
  unit,
  masked,
  viewShort,
  terms,
  targeted,
  defsById,
}: {
  unit: Unit;
  masked: boolean;
  viewShort: string;
  terms: string[];
  targeted: boolean;
  defsById: Map<string, ModelDef>;
}) {
  const caption = tagCaption(unit);
  const revisions = revisionLabels(unit, defsById);
  return (
    <div
      id={`unit-${unit.id}`}
      className={`unit${masked ? " masked" : ""}${targeted ? " matched" : ""} ${styles.unit}`}
      tabIndex={targeted ? -1 : undefined}
    >
      {masked && (
        <p className={styles.notFor}>
          <EyeOff size={13} aria-hidden /> Not for the {viewShort}
        </p>
      )}
      <div className="unit-text">
        <PassageText
          text={unit.text}
          header={unit.header}
          kind={unit.kind}
          terms={terms}
        />
      </div>
      <div className={styles.unitMeta}>
        {unit.models !== null && (
          <UnitModels models={unit.models} defsById={defsById} />
        )}
        {revisions.map((revision) => (
          <span key={revision.key} className="chip tiny accent">
            {revision.text}
          </span>
        ))}
        {caption && (
          <span
            className={styles.caption}
            title="How Finder decided which models this passage applies to"
          >
            <Tag size={12} aria-hidden />
            <span className="sr-only">Models: </span>
            {caption}
          </span>
        )}
        <span className={`mono ${styles.location}`}>{unit.location}</span>
      </div>
      {unit.tag === "override" && unit.tagReason && (
        <p className={styles.reason}>
          <Tag size={12} aria-hidden /> corrected by hand: {unit.tagReason}
        </p>
      )}
    </div>
  );
}

function SectionBlock({
  section,
  units,
  open,
  onToggle,
  view,
  viewShort,
  terms,
  targetUnit,
  defsById,
  documentModels,
}: {
  section: Section;
  units: Unit[];
  open: boolean;
  onToggle: (sectionId: string, open: boolean) => void;
  view: View;
  viewShort: string;
  terms: string[];
  targetUnit: string | null;
  defsById: Map<string, ModelDef>;
  documentModels: string[];
}) {
  const model = view.model;
  const masked = new Set(
    model
      ? units
          .filter(
            (unit) => !unitApplies(unit, documentModels, model, view.revision),
          )
          .map((unit) => unit.id)
      : [],
  );
  const applying = units.length - masked.size;
  const none = model !== null && units.length > 0 && applying === 0;
  // The headings above this one, without the manual's own name.
  const parents = section.path.slice(
    1,
    section.path.at(-1) === section.title ? -1 : undefined,
  );

  return (
    <details
      id={`section-${section.id}`}
      className={styles.section}
      open={open}
      data-none={none || undefined}
      onToggle={(event) => onToggle(section.id, event.currentTarget.open)}
    >
      <summary className={styles.summary}>
        <ChevronRight size={17} className={styles.chevron} aria-hidden />
        <span className={styles.trail}>
          {parents.length > 0 && (
            <span className={styles.parents}>{parents.join(" › ")} ›</span>
          )}
          <span className={styles.title}>{section.title}</span>
        </span>
        <span className={styles.sectionMeta}>
          <span>
            {model
              ? none
                ? `Nothing for the ${viewShort}`
                : `${applying} of ${plural(units.length, "passage")}`
              : plural(units.length, "passage")}
          </span>
          <span className="mono">{section.location}</span>
        </span>
      </summary>
      {open && (
        <div className={styles.units}>
          {units.map((unit) => (
            <UnitBlock
              key={unit.id}
              unit={unit}
              masked={masked.has(unit.id)}
              viewShort={viewShort}
              terms={terms}
              targeted={unit.id === targetUnit}
              defsById={defsById}
            />
          ))}
        </div>
      )}
    </details>
  );
}

// ---------------------------------------------------------------- codes

function CodesPanel({
  detail,
  unitsById,
  view,
  viewShort,
  defsById,
  onShow,
}: {
  detail: DocumentDetail;
  unitsById: Map<string, Unit>;
  view: View;
  viewShort: string;
  defsById: Map<string, ModelDef>;
  onShow: (unitId: string) => void;
}) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  const entries = detail.codeEntries;
  const model = view.model;
  const isMasked = (unitId: string): boolean => {
    const unit = unitsById.get(unitId);
    return Boolean(
      model && unit && !unitApplies(unit, detail.models, model, view.revision),
    );
  };
  const applying = model
    ? entries.filter((entry) => !isMasked(entry.unitId)).length
    : entries.length;
  const shown = all ? entries : entries.slice(0, CODE_PAGE);

  return (
    <section
      id="codes"
      className={`panel ${styles.codesPanel}`}
      aria-labelledby={headingId}
    >
      <div className={styles.panelHead}>
        <h2 id={headingId}>Codes</h2>
        <span className="muted small">
          {model && entries.length
            ? `${applying} of ${plural(entries.length, "code")} for the ${viewShort}`
            : plural(entries.length, "code")}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="muted">
          No codes were found in this manual&rsquo;s tables or headings.
        </p>
      ) : (
        <>
          <p className="muted small">
            The codes and identifiers this manual&rsquo;s tables and headings
            define, with the meaning it gives each, word for word.
            {model
              ? ` Greyed rows are for other models than the ${viewShort}.`
              : ""}
          </p>
          <div className="table-wrap">
            <table className={`table ${styles.codesTable}`}>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Meaning</th>
                  <th scope="col">Models</th>
                  <th scope="col">
                    <span className="sr-only">Passage</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => {
                  const masked = isMasked(entry.unitId);
                  return (
                    <tr
                      key={`${entry.code}\n${entry.unitId}`}
                      className={masked ? styles.codeMasked : undefined}
                    >
                      <td>
                        <CodeDisplay
                          code={entry.code}
                          display={entry.display}
                          scheme={entry.scheme}
                          size="small"
                        />
                      </td>
                      <td className={styles.meaning}>{entry.meaning}</td>
                      <td>
                        {entry.models === null ? (
                          <span
                            className="chip tiny flat"
                            title="Applies to every model this manual covers"
                          >
                            Shared
                          </span>
                        ) : (
                          <UnitModels
                            models={entry.models}
                            defsById={defsById}
                          />
                        )}
                        {masked && (
                          <span className={styles.codeNotFor}>
                            Not for the {viewShort}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn small quiet"
                          onClick={() => onShow(entry.unitId)}
                        >
                          Show passage
                          <span className="sr-only"> for {entry.display}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!all && entries.length > shown.length && (
            <button
              type="button"
              className={`btn ${styles.more}`}
              onClick={() => setAll(true)}
            >
              Show all {entries.length.toLocaleString("en")} codes
            </button>
          )}
        </>
      )}
    </section>
  );
}
