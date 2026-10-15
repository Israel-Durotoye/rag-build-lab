"use client";

import { Check, Copy, LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { getCodes } from "@/lib/api";
import { plural } from "@/lib/text";
import type { CodeRow, CodeScheme, CodesMatrix, Library } from "@/lib/types";
import { SEARCH_INPUT_ID } from "./app-shell";
import { CodeDisplay } from "./code-display";
import { errorMessage, useFinder } from "./finder-provider";
import { Alert, PageHead, PassageText } from "./ui";
import styles from "./codes-view.module.css";

/**
 * Codes: every code in the library against every model. Each cell quotes
 * what that model's manual says the code means. Whether a row differs is the
 * backend's rule (backend/cards.py), never decided here.
 */

type MatrixModel = CodesMatrix["models"][number];

interface OpenCell {
  row: CodeRow;
  model: MatrixModel;
  /** The matrix's models when the cell was opened, for "Other models". */
  models: MatrixModel[];
}

interface Loaded {
  key: string;
  library: Library;
  matrix: CodesMatrix;
  differs: boolean;
}

interface Failed {
  key: string;
  library: Library;
  message: string;
}

const DEBOUNCE_MS = 250;
/** The backend refuses longer filters. */
const MAX_QUERY = 80;
const PAGE_ROWS = 10;
const NAV_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

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

/** Keep the filters in the address bar, so a filtered matrix can be shared. */
function writeQuery(values: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(values)) {
    if (value) params.set(name, value);
    else params.delete(name);
  }
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
  );
}

/** The backend reads "4 long, 4 short" as an LED pattern but not the "·"
 * form it displays, so a pattern is asked about with a comma. */
function spoken(display: string, scheme: CodeScheme): string {
  return scheme === "flash" ? display.replace(/\s*·\s*/g, ", ") : display;
}

function countLine(
  counts: CodesMatrix["counts"],
  onlyDiffering: boolean,
): string {
  const verb = (n: number) => (n === 1 ? "differs" : "differ");
  if (onlyDiffering)
    return `${plural(counts.codes, "code")} that ${verb(counts.codes)} between models`;
  return `${plural(counts.codes, "code")}, ${counts.differing.toLocaleString("en")} that ${verb(counts.differing)} between models`;
}

/** Where an arrow key (or Home, End, Page Up, Page Down) moves from cell
 * (r, c). Empty cells are skipped: only a code a manual has can be opened. */
function step(
  matrix: CodesMatrix,
  r: number,
  c: number,
  key: string,
  ctrl: boolean,
): [number, number] | null {
  const { rows, models } = matrix;
  const has = (ri: number, ci: number) =>
    ri >= 0 &&
    ri < rows.length &&
    ci >= 0 &&
    ci < models.length &&
    Boolean(rows[ri].cells[models[ci].id]);
  const across = (ri: number, from: number, by: 1 | -1) => {
    for (let ci = from; ci >= 0 && ci < models.length; ci += by)
      if (has(ri, ci)) return ci;
    return -1;
  };
  const down = (from: number, ci: number, by: 1 | -1) => {
    for (let ri = from; ri >= 0 && ri < rows.length; ri += by)
      if (has(ri, ci)) return ri;
    return -1;
  };
  switch (key) {
    case "ArrowRight": {
      const ci = across(r, c + 1, 1);
      return ci < 0 ? null : [r, ci];
    }
    case "ArrowLeft": {
      const ci = across(r, c - 1, -1);
      return ci < 0 ? null : [r, ci];
    }
    case "ArrowDown": {
      const ri = down(r + 1, c, 1);
      return ri < 0 ? null : [ri, c];
    }
    case "ArrowUp": {
      const ri = down(r - 1, c, -1);
      return ri < 0 ? null : [ri, c];
    }
    case "PageDown": {
      const ri = down(Math.min(r + PAGE_ROWS, rows.length - 1), c, -1);
      return ri > r ? [ri, c] : null;
    }
    case "PageUp": {
      const ri = down(Math.max(r - PAGE_ROWS, 0), c, 1);
      return ri >= 0 && ri < r ? [ri, c] : null;
    }
    case "Home": {
      if (!ctrl) {
        const ci = across(r, 0, 1);
        return ci < 0 ? null : [r, ci];
      }
      for (let ri = 0; ri < rows.length; ri++) {
        const ci = across(ri, 0, 1);
        if (ci >= 0) return [ri, ci];
      }
      return null;
    }
    case "End": {
      if (!ctrl) {
        const ci = across(r, models.length - 1, -1);
        return ci < 0 ? null : [r, ci];
      }
      for (let ri = rows.length - 1; ri >= 0; ri--) {
        const ci = across(ri, models.length - 1, -1);
        if (ci >= 0) return [ri, ci];
      }
      return null;
    }
    default:
      return null;
  }
}

/** The one cell that takes the Tab stop (arrow keys move it): the last one
 * focused while it is still in the matrix, else the first cell with a code. */
function tabStop(
  matrix: CodesMatrix,
  active: { code: string; model: string } | null,
): { code: string; model: string } | null {
  if (active && matrix.models.some((m) => m.id === active.model)) {
    const row = matrix.rows.find((r) => r.code === active.code);
    if (row?.cells[active.model]) return active;
  }
  for (const row of matrix.rows)
    for (const model of matrix.models)
      if (row.cells[model.id]) return { code: row.code, model: model.id };
  return null;
}

function cellIndex(target: EventTarget): [number, number] | null {
  if (!(target instanceof HTMLElement)) return null;
  const r = Number(target.dataset.r);
  const c = Number(target.dataset.c);
  return Number.isInteger(r) && Number.isInteger(c) ? [r, c] : null;
}

/** A code as the device shows it; an LED pattern also gets its words. */
function CodeLabel({
  row,
}: {
  row: Pick<CodeRow, "code" | "display" | "scheme">;
}) {
  return (
    <span className={styles.codeStack}>
      <CodeDisplay
        code={row.code}
        display={row.display}
        scheme={row.scheme}
        size="small"
      />
      {row.scheme === "flash" && (
        <span className={styles.codeWords}>{row.display}</span>
      )}
    </span>
  );
}

const MatrixRow = memo(function MatrixRow({
  row,
  r,
  models,
  working,
  activeModel,
  openModel,
  onOpen,
}: {
  row: CodeRow;
  r: number;
  models: MatrixModel[];
  working: string | null;
  /** The model whose cell in this row takes the Tab stop, if any. */
  activeModel: string | null;
  /** The model whose cell in this row is open in the side panel, if any. */
  openModel: string | null;
  onOpen: (row: CodeRow, model: MatrixModel, from: HTMLElement) => void;
}) {
  return (
    <tr className={row.differs ? styles.differs : undefined}>
      <th scope="row">
        <span className={styles.rowHead}>
          <CodeLabel row={row} />
          {row.differs && <span className="chip tiny accent">Differs</span>}
        </span>
      </th>
      {models.map((model, c) => {
        const cell = row.cells[model.id];
        const tint = model.id === working ? styles.working : "";
        if (!cell)
          return (
            <td key={model.id} className={`${styles.none} ${tint}`}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Not in its manuals</span>
            </td>
          );
        return (
          <td key={model.id} className={tint || undefined}>
            <button
              type="button"
              className={styles.cell}
              data-r={r}
              data-c={c}
              tabIndex={activeModel === model.id ? 0 : -1}
              aria-current={openModel === model.id ? "true" : undefined}
              onClick={(event) => onOpen(row, model, event.currentTarget)}
            >
              <span className={styles.clamp}>{cell.meaning}</span>
              <span className={styles.full} aria-hidden="true">
                {cell.meaning}
              </span>
            </button>
          </td>
        );
      })}
    </tr>
  );
});

/** The question "Ask about this" sends for the open cell. */
function questionFor(open: OpenCell): string {
  const entry = open.row.cells[open.model.id];
  return `What is ${spoken(entry?.display ?? open.row.display, open.row.scheme)}?`;
}

function CodeDetail({
  open,
  titleRef,
  panelRef,
  generation,
  onClose,
  onPick,
  onAsk,
}: {
  open: OpenCell;
  titleRef: RefObject<HTMLHeadingElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  generation: boolean;
  onClose: () => void;
  onPick: (model: MatrixModel) => void;
  onAsk: (question: string) => void;
}) {
  const { row, model, models } = open;
  const entry = row.cells[model.id];
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (!entry) return null;
  const others = models.filter((m) => m.id !== model.id && row.cells[m.id]);
  const missing = models.filter((m) => m.id !== model.id && !row.cells[m.id]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(entry.chunkId)
      .then(() => {
        setCopiedId(entry.chunkId);
        window.setTimeout(() => setCopiedId(null), 1800);
      })
      .catch(() => undefined);
  };
  const copied = copiedId === entry.chunkId;
  // The panel only renders after a click, so this never runs on the server.
  const canCopy =
    typeof navigator !== "undefined" && Boolean(navigator.clipboard);
  const question = questionFor(open);

  return (
    <aside
      ref={panelRef}
      className={`panel panel-lg ${styles.detail}`}
      aria-label={`${entry.display} on the ${model.name}`}
    >
      <div className={styles.detailHead}>
        <span className="eyebrow">Code on the {model.short}</span>
        <button
          type="button"
          className="btn icon small quiet"
          aria-label="Close the code panel"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className={styles.detailCode}>
        <CodeDisplay
          code={row.code}
          display={entry.display}
          scheme={row.scheme}
        />
        {row.scheme === "flash" && (
          <span className={styles.codeWords}>{entry.display}</span>
        )}
      </div>
      <h2 ref={titleRef} tabIndex={-1} className={styles.detailTitle}>
        {model.name}
      </h2>
      {row.differs && (
        <p className={styles.detailNote}>
          <span className="chip tiny accent">Differs</span>
          The models&rsquo; manuals give this code different meanings.
        </p>
      )}
      {entry.display !== row.display && (
        <p className="small muted">
          Written &ldquo;{entry.display}&rdquo; in this manual.
        </p>
      )}

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>What its manual says</h3>
        <div className="well">
          <PassageText
            text={entry.meaning}
            header={entry.header}
            kind={entry.meaning.includes(" | ") ? "row" : "paragraph"}
          />
        </div>
        <p className={styles.chunk}>
          <span className="faint small">Passage</span>
          <code>{entry.chunkId}</code>
          {canCopy && (
            <button
              type="button"
              className="btn small quiet"
              onClick={copy}
              aria-label={copied ? "Passage ID copied" : "Copy the passage ID"}
            >
              {copied ? (
                <Check size={14} aria-hidden />
              ) : (
                <Copy size={14} aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </p>
      </section>

      <div className={styles.detailSection}>
        <button
          type="button"
          className="btn primary"
          onClick={() => onAsk(question)}
        >
          <Search size={16} aria-hidden /> Ask about this on {model.short}
        </button>
        <p className="hint">
          Searches &ldquo;{question}&rdquo; with the {model.name} as the model
          you are working on.
          {!generation &&
            " No model key is configured, so the answer quotes the manual’s own sentences."}
        </p>
      </div>

      {(others.length > 0 || missing.length > 0) && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailLabel}>Other models</h3>
          {others.length > 0 && (
            <ul className={styles.others}>
              {others.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={styles.other}
                    onClick={() => onPick(m)}
                    title={m.name}
                  >
                    <span className={styles.otherShort}>{m.short}</span>
                    <span className={styles.otherText}>
                      {row.cells[m.id]?.meaning}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <p className="small faint">
              Not in the manuals of the {missing.map((m) => m.short).join(", ")}
              .
            </p>
          )}
        </section>
      )}
    </aside>
  );
}

function MatrixSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="skeleton" />
      ))}
    </div>
  );
}

function NoManuals({ documents }: { documents: number }) {
  return (
    <div className="empty">
      <h2>{documents ? "No models yet" : "No manuals yet"}</h2>
      <p>
        {documents
          ? "Your manuals don’t name any models yet. Confirm the models each one covers on the Library page, and their codes appear here."
          : "This page lists every code in your manuals against every model they cover. Add the sample library or upload a manual on the Library page."}
      </p>
      <Link href="/library" className="btn primary">
        Open the Library
      </Link>
    </div>
  );
}

export function CodesView() {
  const router = useRouter();
  const {
    health,
    library,
    libraryError,
    refreshLibrary,
    selection,
    setSelection,
    runSearch,
    pickerOpen,
  } = useFinder();
  const search = useQueryString();
  const hydrated = search !== null;
  const initial = useMemo(() => {
    const params = new URLSearchParams(search ?? "");
    return {
      q: (params.get("q") ?? "").slice(0, MAX_QUERY),
      family: params.get("family"),
      differs: params.get("differs") === "1",
    };
  }, [search]);

  // What the person has changed; null (or undefined) means the address bar's value.
  const [typed, setTyped] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [pickedFamily, setPickedFamily] = useState<string | null | undefined>(
    undefined,
  );
  const [pickedDiffers, setPickedDiffers] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [open, setOpen] = useState<OpenCell | null>(null);
  const [active, setActive] = useState<{ code: string; model: string } | null>(
    null,
  );
  const tbody = useRef<HTMLTableSectionElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const switchLabel = useId();

  const query = typed ?? initial.q;
  const q = (settled ?? initial.q).trim();
  // Only families some model belongs to: the backend filters on a model's family.
  const families = useMemo(() => {
    if (!library) return [];
    return library.families.filter((f) =>
      library.models.some((m) => m.family === f.id),
    );
  }, [library]);
  const wanted = pickedFamily === undefined ? initial.family : pickedFamily;
  const family =
    wanted && families.some((f) => f.id === wanted) ? wanted : null;
  const differs = pickedDiffers ?? initial.differs;
  const key = JSON.stringify([q, family, differs, attempt]);
  const ready = hydrated && Boolean(library && library.models.length > 0);

  // The search waits until typing pauses.
  useEffect(() => {
    if (typed === null) return;
    const timer = window.setTimeout(() => {
      setSettled(typed);
      writeQuery({ q: typed.trim() || null });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (!ready || !library) return;
    const controller = new AbortController();
    getCodes(
      { q: q || undefined, family: family ?? undefined, differs },
      controller.signal,
    )
      .then((matrix) => {
        if (!controller.signal.aborted)
          setLoaded({ key, library, matrix, differs });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailed({
          key,
          library,
          message: errorMessage(
            cause,
            "The codes couldn’t be loaded. Try again.",
          ),
        });
      });
    return () => controller.abort();
  }, [ready, library, key, q, family, differs]);

  const fresh =
    loaded && loaded.key === key && loaded.library === library
      ? loaded.matrix
      : null;
  const failure =
    failed && failed.key === key && failed.library === library
      ? failed.message
      : null;
  const loading = ready && !fresh && !failure;
  // While a new filter loads, the last matrix stays on screen, dimmed.
  const matrix = ready ? (fresh ?? loaded?.matrix ?? null) : null;
  const hasFlash = Boolean(matrix?.rows.some((row) => row.scheme === "flash"));

  const activeCell = matrix ? tabStop(matrix, active) : null;

  const openCell = useCallback(
    (row: CodeRow, model: MatrixModel, from: HTMLElement) => {
      trigger.current = from;
      setOpen({ row, model, models: matrix?.models ?? [model] });
    },
    [matrix],
  );

  /** Back to the open cell in the matrix, or to whatever opened the panel. */
  const focusMatrix = useCallback(
    (cell: OpenCell | null) => {
      const r =
        cell && matrix
          ? matrix.rows.findIndex((row) => row.code === cell.row.code)
          : -1;
      const c =
        cell && matrix
          ? matrix.models.findIndex((m) => m.id === cell.model.id)
          : -1;
      const target =
        r >= 0 && c >= 0
          ? tbody.current?.querySelector<HTMLElement>(
              `[data-r="${r}"][data-c="${c}"]`,
            )
          : null;
      (target ?? trigger.current)?.focus();
    },
    [matrix],
  );

  const close = useCallback(() => {
    const inside = Boolean(panel.current?.contains(document.activeElement));
    const was = open;
    setOpen(null);
    if (inside) focusMatrix(was);
  }, [focusMatrix, open]);

  // Esc closes the panel (unless the model picker is open: Esc closes that).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !pickerOpen && !event.defaultPrevented)
        close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pickerOpen, close]);

  const onMatrixKey = useCallback(
    (event: KeyboardEvent<HTMLTableSectionElement>) => {
      if (!matrix || !NAV_KEYS.has(event.key)) return;
      const at = cellIndex(event.target);
      if (!at) return;
      event.preventDefault();
      const next = step(
        matrix,
        at[0],
        at[1],
        event.key,
        event.ctrlKey || event.metaKey,
      );
      if (!next) return;
      tbody.current
        ?.querySelector<HTMLElement>(
          `[data-r="${next[0]}"][data-c="${next[1]}"]`,
        )
        ?.focus();
    },
    [matrix],
  );

  const onMatrixFocus = useCallback(
    (event: FocusEvent<HTMLTableSectionElement>) => {
      const at = cellIndex(event.target);
      const row = at && matrix?.rows[at[0]];
      const model = at && matrix?.models[at[1]];
      if (row && model)
        setActive((current) =>
          current?.code === row.code && current.model === model.id
            ? current
            : { code: row.code, model: model.id },
        );
    },
    [matrix],
  );

  const pickFamily = (id: string | null) => {
    setPickedFamily(id);
    writeQuery({ family: id });
  };
  const toggleDiffers = () => {
    setPickedDiffers(!differs);
    writeQuery({ differs: differs ? null : "1" });
  };
  const clearFilters = () => {
    setTyped("");
    setSettled("");
    setPickedFamily(null);
    setPickedDiffers(false);
    writeQuery({ q: null, family: null, differs: null });
  };

  const pickOther = (model: MatrixModel) => {
    if (!open) return;
    setOpen({ ...open, model });
    // The button just pressed leaves the list; keep focus in the panel.
    window.requestAnimationFrame(() => title.current?.focus());
  };

  const askAbout = (question: string) => {
    if (!open) return;
    const choice = { model: open.model.id, revision: null };
    setSelection(choice);
    void runSearch(question, choice);
    router.push("/");
  };

  let content: ReactNode;
  if (!library) {
    content = !health ? (
      <Alert tone="warn">
        The Finder backend isn&rsquo;t reachable. It may still be starting; this
        page loads as soon as it answers.
      </Alert>
    ) : libraryError ? null : (
      <MatrixSkeleton />
    );
  } else if (library.models.length === 0) {
    content = <NoManuals documents={library.documents.length} />;
  } else {
    const working = selection.model;
    content = (
      <>
        <section
          className={`panel ${styles.filters}`}
          aria-label="Filter the codes"
        >
          <div className={styles.filterTop}>
            <label className={`field ${styles.search}`}>
              <Search size={17} aria-hidden />
              <input
                id={SEARCH_INPUT_ID}
                type="search"
                value={query}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Filter by code or meaning"
                aria-label="Filter by code or meaning"
                maxLength={MAX_QUERY}
                autoComplete="off"
                spellCheck={false}
              />
              {loading && (
                <LoaderCircle size={16} className="spin" aria-hidden />
              )}
            </label>
            <label className={styles.toggle}>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={differs}
                aria-labelledby={switchLabel}
                onClick={toggleDiffers}
              />
              <span id={switchLabel}>Only codes that differ</span>
            </label>
          </div>
          {families.length > 1 && (
            <div className={styles.families} role="group" aria-label="Family">
              <span className={styles.familyLabel} aria-hidden="true">
                Family
              </span>
              <button
                type="button"
                className="chip"
                aria-pressed={family === null}
                onClick={() => pickFamily(null)}
              >
                All families
              </button>
              {families.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="chip"
                  aria-pressed={family === f.id}
                  onClick={() => pickFamily(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <div className={styles.status}>
            <p
              className={styles.counts}
              aria-live="polite"
              data-stale={loading || undefined}
            >
              {loaded
                ? countLine(loaded.matrix.counts, loaded.differs)
                : "\u00a0"}
            </p>
            {hasFlash && (
              <p className={styles.legend}>
                <span
                  className={`lcd small ${styles.legendLcd}`}
                  aria-hidden="true"
                >
                  <span className="blinks">
                    <i className="long" />
                  </span>
                </span>
                long flash
                <span
                  className={`lcd small ${styles.legendLcd}`}
                  aria-hidden="true"
                >
                  <span className="blinks">
                    <i />
                  </span>
                </span>
                short flash
              </p>
            )}
          </div>
        </section>

        <div className={`${styles.layout}${open ? ` ${styles.open}` : ""}`}>
          <div className={styles.main}>
            {failure && (
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
            )}
            {!matrix ? (
              loading && <MatrixSkeleton />
            ) : matrix.rows.length === 0 || matrix.models.length === 0 ? (
              <div className="empty">
                <h2>
                  {q
                    ? `Nothing matches “${q}”`
                    : differs
                      ? "No codes differ"
                      : "No codes found"}
                </h2>
                <p>
                  {q
                    ? "No code, and no meaning in any manual, contains this text."
                    : differs
                      ? "No code has a different meaning on any of these models."
                      : "No codes were found in these manuals."}
                </p>
                {(q || differs || family) && (
                  <button type="button" className="btn" onClick={clearFilters}>
                    Clear the filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {matrix.rows.length < matrix.counts.codes && (
                  <p className="small muted">
                    Showing the first {matrix.rows.length.toLocaleString("en")}.
                    Narrow the filter to see the rest.
                  </p>
                )}
                <div
                  className={`table-wrap ${styles.wrap}`}
                  data-stale={loading || undefined}
                  aria-busy={loading || undefined}
                >
                  <table className={`table ${styles.matrix}`}>
                    <caption className="sr-only">
                      Codes by model. Each cell quotes what that model&rsquo;s
                      manual says the code means.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className={styles.corner}>
                          Code
                        </th>
                        {matrix.models.map((model) => (
                          <th
                            key={model.id}
                            scope="col"
                            className={
                              model.id === working
                                ? styles.workingHead
                                : undefined
                            }
                          >
                            <span className={styles.modelShort}>
                              {model.short}
                            </span>
                            <span className={styles.modelName}>
                              {model.name}
                            </span>
                            {model.id === working && (
                              <span className={styles.workingTag}>
                                Working on
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody
                      ref={tbody}
                      onKeyDown={onMatrixKey}
                      onFocus={onMatrixFocus}
                    >
                      {matrix.rows.map((row, r) => (
                        <MatrixRow
                          key={row.code}
                          row={row}
                          r={r}
                          models={matrix.models}
                          working={working}
                          activeModel={
                            activeCell?.code === row.code
                              ? activeCell.model
                              : null
                          }
                          openModel={
                            open?.row.code === row.code ? open.model.id : null
                          }
                          onOpen={openCell}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.keys}>
                  A dash means that model&rsquo;s manuals don&rsquo;t have the
                  code.{" "}
                  <span className={styles.keyNote}>
                    In the table, <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd>{" "}
                    <kbd>↓</kbd> move between cells and <kbd>Enter</kbd> opens
                    one.
                  </span>
                </p>
              </>
            )}
          </div>
          {open && (
            <CodeDetail
              open={open}
              titleRef={title}
              panelRef={panel}
              generation={Boolean(health?.generation)}
              onClose={close}
              onPick={pickOther}
              onAsk={askAbout}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Codes" title="Every code, every model">
        Every code, pin, LED pattern and part reference in your manuals, against
        every model they cover. Each cell quotes that model&rsquo;s manual word
        for word; Differs marks a code whose meaning is not the same on every
        model that has it. Nothing here is generated.
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
      <p className="sr-only" aria-live="polite">
        {open
          ? `${open.row.cells[open.model.id]?.display ?? open.row.display} on the ${open.model.name} is open in the panel after the table.`
          : ""}
      </p>
    </>
  );
}
