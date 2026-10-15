"use client";

import {
  Handshake,
  LoaderCircle,
  Medal,
  Play,
  RotateCcw,
  Search,
  Sigma,
  Target,
} from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getEvaluation, runLab } from "@/lib/api";
import { arithmetic, fuse } from "@/lib/rrf";
import { formatMs, plural, trail } from "@/lib/text";
import type {
  ChunkInfo,
  KeywordResult,
  LabFused,
  LabResult,
  LabelledQuery,
  LibraryModel,
  SemanticResult,
} from "@/lib/types";
import { SEARCH_INPUT_ID } from "./app-shell";
import { errorMessage, useFinder } from "./finder-provider";
import { Alert, ModelChip, PageHead, PassageText } from "./ui";
import styles from "./lab-view.module.css";

/**
 * The search-mode lab: one query through keyword, semantic and hybrid search
 * with the same model filter. Hybrid sits in the middle so each line shows
 * one retriever's contribution to a fused rank. Moving the RRF constant
 * re-fuses the two lists in the browser (lib/rrf.ts, the backend's exact
 * arithmetic and tie rule); only a new query or filter asks the server.
 */

const COLUMNS = ["keyword", "hybrid", "semantic"] as const;
type Column = (typeof COLUMNS)[number];

const NAME: Record<Column, string> = {
  keyword: "Keyword",
  hybrid: "Hybrid",
  semantic: "Semantic",
};
const LETTER: Record<Column, string> = {
  keyword: "K",
  hybrid: "H",
  semantic: "S",
};
/** Neighbouring columns, left to right: a line joins a passage across each pair. */
const PAIRS: [Column, Column][] = [
  ["keyword", "hybrid"],
  ["hybrid", "semantic"],
];
/** Rank pills read "K2 · S5 · H1". */
const PILL_ORDER: Column[] = ["keyword", "semantic", "hybrid"];

const K_RANGE: [number, number] = [1, 10];
const CONSTANT_RANGE: [number, number] = [1, 1000];
const SLIDER_MAX = 200;
const TIE_RULE =
  "A tie goes to the better single best rank, then the passage ID.";
/** Where a line meets a card: the centre of its rank circle. */
const ANCHOR_Y = 29;

// ---------------------------------------------------------------- helpers

/** The filter select's value: "" (no filter), "model" or "model/revision". */
function filterValue(
  model: string | null | undefined,
  revision?: string | null,
): string {
  if (!model) return "";
  return revision ? `${model}/${revision}` : model;
}

function parseFilter(value: string): {
  model: string | null;
  revision: string | null;
} {
  const [model = "", revision = ""] = value.split("/");
  return { model: model || null, revision: revision || null };
}

function isWhole(text: string, [low, high]: [number, number]): boolean {
  if (!/^\s*\d+\s*$/.test(text)) return false;
  const value = Number(text);
  return value >= low && value <= high;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** A fused score as an exact, reduced fraction, so tied passages group exactly. */
function exactScore(
  ranks: [number | null, number | null],
  constant: number,
): string {
  let num = 0;
  let den = 1;
  for (const rank of ranks) {
    if (rank === null) continue;
    const part = constant + rank;
    num = num * part + den;
    den *= part;
    const divisor = gcd(num, den) || 1;
    num /= divisor;
    den /= divisor;
  }
  return `${num}/${den}`;
}

/** How much more rank 1 counts than rank 10 at this constant. */
function weight(constant: number): string {
  return ((constant + 10) / (constant + 1)).toFixed(2);
}

/** A passage's text in one line: a table row without its header line, list
 * items without their markers. The card shows the full text when opened. */
function snippetOf(chunk: ChunkInfo): string {
  const lines = chunk.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const body =
    chunk.header && lines[0] === chunk.header.trim() ? lines.slice(1) : lines;
  return body.map((line) => line.replace(/^[-*•]\s+/, "")).join(" · ");
}

function appliesTo(
  chunk: ChunkInfo,
  model: string,
  docModels: string[] | undefined,
): boolean {
  if (chunk.models === null) return !docModels || docModels.includes(model);
  return chunk.models.includes(model);
}

// The page can be opened with a query: /lab?q=…&model=…&revision=….
function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
const locationSearch = () => window.location.search;
const noSearch = () => "";

// ---------------------------------------------------------------- geometry

interface Anchor {
  left: number;
  right: number;
  y: number;
}
type Anchors = Record<string, Anchor>;

interface Wire {
  key: string;
  id: string;
  d: string;
  /** Both ends are in the top k. */
  within: boolean;
}

/** A short line pointing at a rank that the shown depth leaves out. */
interface Stub {
  key: string;
  id: string;
  d: string;
  x: number;
  y: number;
  label: string;
  anchor: "start" | "end";
}

function half(value: number): number {
  return Math.round(value * 2) / 2;
}

function sameAnchors(a: Anchors, b: Anchors): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const one = a[key];
    const two = b[key];
    return (
      two !== undefined &&
      one.left === two.left &&
      one.right === two.right &&
      one.y === two.y
    );
  });
}

// ---------------------------------------------------------------- small parts

/** Whether semantic search can run, as the backend reports it. */
export function SemanticStatus() {
  const { health } = useFinder();
  if (!health)
    return (
      <p className="status bad">
        <i aria-hidden /> Backend offline
      </p>
    );
  const { status, model } = health.embeddings;
  if (status === "ready")
    return (
      <p className="status" title={model}>
        <i aria-hidden /> Semantic search on
      </p>
    );
  if (status === "loading")
    return (
      <p className="status warn" title={model}>
        <i aria-hidden /> Semantic model loading
      </p>
    );
  return (
    <p className="status warn" title={model}>
      <i aria-hidden />{" "}
      {status === "failed"
        ? "Semantic model failed to load"
        : "Semantic search off"}
    </p>
  );
}

/** A whole-number field that accepts any typing and applies valid values. */
function WholeNumber({
  value,
  range,
  onChange,
  label,
  describedBy,
}: {
  value: number;
  range: [number, number];
  onChange: (value: number) => void;
  label?: string;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={range[0]}
      max={range[1]}
      step={1}
      value={text}
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={!isWhole(text, range) || undefined}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (isWhole(next, range)) onChange(Number(next));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function Explainer({ constant }: { constant: number }) {
  return (
    <section
      className={`well ${styles.explainer}`}
      aria-label="How hybrid search combines the two lists"
    >
      <div className={styles.point}>
        <Sigma size={18} aria-hidden />
        <p>
          <strong>Hybrid adds ranks, not scores.</strong> A BM25 score and a
          cosine similarity are on different scales, so adding them would mean
          nothing. Each list a passage is in adds 1&thinsp;/&thinsp;(constant +
          its rank there).
        </p>
      </div>
      <div className={styles.point}>
        <Medal size={18} aria-hidden />
        <p>
          <strong>
            A small constant rewards one retriever&rsquo;s top rank.
          </strong>{" "}
          At 1, rank 1 is worth 1/2 and rank 10 only 1/11, so one list&rsquo;s
          favourite can come first on its own.
        </p>
      </div>
      <div className={styles.point}>
        <Handshake size={18} aria-hidden />
        <p>
          <strong>A large constant rewards agreement between them.</strong> At
          200, rank 1 (1/201) and rank 10 (1/210) are worth almost the same, so
          a passage both lists found comes first.
        </p>
      </div>
      <p className={styles.now}>
        At the constant now set, <b>{constant}</b>, rank 1 counts{" "}
        <b>{weight(constant)}×</b> as much as rank 10.
      </p>
    </section>
  );
}

/** The models a passage applies to. With no filter, models other than the
 * one in question are greyed. */
function CardModels({
  chunk,
  reference,
  docModels,
}: {
  chunk: ChunkInfo;
  reference: string | null;
  docModels: string[] | undefined;
}) {
  const { modelById } = useFinder();
  if (chunk.models === null) {
    const covers =
      reference === null || !docModels || docModels.includes(reference);
    return (
      <span
        className={`chip tiny ${covers ? "flat" : "other"}`}
        title="Applies to every model its manual covers"
      >
        Shared
      </span>
    );
  }
  return (
    <>
      {chunk.models.map((id) => {
        const model = modelById(id);
        const revisions = chunk.revisions[id];
        return (
          <Fragment key={id}>
            <ModelChip
              model={model ?? { id, short: id, name: id }}
              other={reference !== null && id !== reference}
            />
            {revisions?.length ? (
              <span
                className="chip tiny flat"
                title={`Only these revisions of the ${model?.name ?? id}`}
              >
                {revisions
                  .map(
                    (rev) =>
                      model?.revisions.find((r) => r.id === rev)?.label ?? rev,
                  )
                  .join(", ")}
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

function KeywordFigures({
  hit,
  queryTerms,
}: {
  hit: KeywordResult;
  queryTerms: number;
}) {
  return (
    <>
      <span className={styles.figures}>
        <span>
          BM25 <b>{hit.score}</b>
        </span>
        <span>
          {hit.terms.length} of {plural(queryTerms, "query word")}
        </span>
      </span>
      {hit.terms.length > 0 && (
        <span className={styles.terms}>
          <span className="sr-only">Matched words: </span>
          {hit.terms.map((term) => (
            <span key={term} className={`chip tiny flat ${styles.term}`}>
              {term}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

function SemanticFigures({ hit }: { hit: SemanticResult }) {
  return (
    <span className={styles.figures}>
      <span>
        cosine <b>{hit.similarity.toFixed(4)}</b>
      </span>
    </span>
  );
}

function HybridFigures({
  entry,
  constant,
  mates,
}: {
  entry: LabFused;
  constant: number;
  /** The other passages with exactly this score. */
  mates: LabFused[];
}) {
  const [keyword, semantic] = entry.ranks;
  const sources =
    keyword !== null && semantic !== null
      ? `keyword ${keyword} + semantic ${semantic}`
      : keyword !== null
        ? `keyword ${keyword} only`
        : `semantic ${semantic} only`;
  const shownMates = mates.slice(0, 3).map((mate) => `H${mate.rank}`);
  // Equal best ranks too: the order between them comes from the passage IDs.
  const byId = mates.some((mate) => mate.bestRank === entry.bestRank);
  return (
    <>
      <span className={styles.figures}>
        <span>{sources}</span>
      </span>
      <code className={styles.arith}>
        {arithmetic(entry.ranks, constant)} = <b>{entry.score.toFixed(6)}</b>
      </code>
      {entry.tied && (
        <span className={styles.tie}>
          <span className="chip tiny warn" title={TIE_RULE}>
            Tie
          </span>
          <span>
            {shownMates.length > 0 &&
              `with ${shownMates.join(", ")}${mates.length > 3 ? ` and ${mates.length - 3} more` : ""} · `}
            best single rank {entry.bestRank}
            {byId ? " (shared, so the passage ID decides)" : ""}
          </span>
          <span className="sr-only">{TIE_RULE}</span>
        </span>
      )}
    </>
  );
}

function PassageCard({
  column,
  id,
  rank,
  chunk,
  expected,
  open,
  linked,
  other,
  ranks,
  reference,
  docModels,
  terms,
  figures,
  onToggle,
  onHot,
  register,
}: {
  column: Column;
  id: string;
  rank: number;
  chunk: ChunkInfo | undefined;
  expected: boolean;
  open: boolean;
  linked: boolean;
  /** Not for the model in question (no filter only): hatched. */
  other: boolean;
  ranks: Record<Column, number | undefined>;
  reference: string | null;
  docModels: string[] | undefined;
  terms: string[];
  figures: ReactNode;
  onToggle: () => void;
  onHot: (id: string | null) => void;
  register: (key: string, element: HTMLElement | null) => void;
}) {
  const detailId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const key = `${column}|${id}`;
  const spoken = PILL_ORDER.map((c) =>
    ranks[c] === undefined
      ? `not in the ${NAME[c].toLowerCase()} list`
      : `${NAME[c].toLowerCase()} rank ${ranks[c]}`,
  ).join(", ");
  return (
    <li
      ref={(element) => {
        register(key, element);
        return () => register(key, null);
      }}
      className={styles.card}
      data-open={open || undefined}
      data-linked={(linked && !open) || undefined}
      data-other={other || undefined}
      onMouseEnter={() => onHot(id)}
      onMouseLeave={() => onHot(null)}
    >
      <button
        type="button"
        className={styles.cardButton}
        aria-labelledby={nameId}
        aria-describedby={descriptionId}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
        onFocus={() => onHot(id)}
        onBlur={() => onHot(null)}
      >
        <span className="rank" aria-hidden>
          {rank}
        </span>
        <span className={styles.cardBody}>
          <span id={nameId} className={styles.name}>
            <span className="sr-only">
              {NAME[column]} rank {rank}:{" "}
            </span>
            <strong className={styles.title}>{chunk?.title ?? id}</strong>
          </span>
          <span id={descriptionId} className={styles.description}>
            {chunk && (
              <span className={styles.snippet}>{snippetOf(chunk)}</span>
            )}
            <span className={styles.meta}>
              {chunk && <span className={styles.doc}>{chunk.docName}</span>}
              {chunk && (
                <CardModels
                  chunk={chunk}
                  reference={reference}
                  docModels={docModels}
                />
              )}
              {expected && (
                <span className="chip tiny accent">
                  <Target size={12} aria-hidden /> Expected
                </span>
              )}
              {other && (
                <span className="sr-only">(not for the model in question)</span>
              )}
            </span>
            {figures}
            <span className={styles.pills} aria-hidden>
              {PILL_ORDER.map((c, index) => (
                <Fragment key={c}>
                  {index > 0 && <i>·</i>}
                  <span
                    data-self={c === column || undefined}
                    data-missing={ranks[c] === undefined || undefined}
                  >
                    {LETTER[c]}
                    {ranks[c] ?? "–"}
                  </span>
                </Fragment>
              ))}
            </span>
            <span className="sr-only">{spoken}.</span>
          </span>
        </span>
      </button>
      {open && chunk && (
        <div id={detailId} className={styles.detail}>
          <PassageText
            text={chunk.text}
            header={chunk.header}
            kind={chunk.kind}
            terms={terms}
          />
          <dl className={styles.where}>
            <div>
              <dt>Section</dt>
              <dd>{trail(chunk.path) || chunk.title}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd className="mono">{chunk.location}</dd>
            </div>
            <div>
              <dt>Passage ID</dt>
              <dd className="mono">{id}</dd>
            </div>
          </dl>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- the page

export function LabView() {
  const { health, library, libraryError, modelById, selection, settings } =
    useFinder();

  const search = useSyncExternalStore(
    subscribeToHistory,
    locationSearch,
    noSearch,
  );
  const linkedQuery = useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      query: params.get("q")?.trim() ?? "",
      filter: filterValue(params.get("model"), params.get("revision")),
    };
  }, [search]);

  const [queryDraft, setQueryDraft] = useState<string | null>(null);
  const [filterChoice, setFilterChoice] = useState<string | null>(null);
  const [kChoice, setKChoice] = useState<number | null>(null);
  const [constantChoice, setConstantChoice] = useState<number | null>(null);
  const [labelled, setLabelled] = useState<LabelledQuery[] | null>(null);
  const [result, setResult] = useState<LabResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ column: Column; id: string } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [depth, setDepth] = useState<"top" | "all">("top");
  const [active, setActive] = useState<Column>("hybrid");
  const [anchors, setAnchors] = useState<Anchors | null>(null);

  const controller = useRef<AbortController | null>(null);
  const linkRan = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const columnEls = useRef(new Map<Column, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const frame = useRef(0);

  // Until something is chosen here: the query in the link, the model being
  // worked on, the k and constant of the workspace's settings.
  const query = queryDraft ?? linkedQuery.query;
  const chosenFilter =
    filterChoice ??
    (linkedQuery.query
      ? linkedQuery.filter
      : filterValue(selection.model, selection.revision));
  const filter = useMemo(() => {
    if (!library) return chosenFilter;
    const { model, revision } = parseFilter(chosenFilter);
    const found = library.models.find((m) => m.id === model);
    if (!found) return "";
    return filterValue(
      found.id,
      found.revisions.some((r) => r.id === revision) ? revision : null,
    );
  }, [library, chosenFilter]);
  const savedConstant =
    settings?.settings.rrfConstant ?? health?.retrieval.rrfConstant ?? 60;
  const k = kChoice ?? settings?.settings.k ?? 5;
  const constant = constantChoice ?? savedConstant;
  const topCount = Math.max(10, k + 5);
  const depthCount = depth === "all" ? Number.POSITIVE_INFINITY : topCount;
  const online = health !== null;
  const noManuals = !!library && library.documents.length === 0;

  // The labelled queries, offered as quick picks.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    getEvaluation()
      .then((info) => {
        if (!cancelled) setLabelled(info.queries);
      })
      .catch(() => {
        if (!cancelled) setLabelled([]);
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  const run = useCallback(
    async (text: string, chosen: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setRunning(true);
      setError(null);
      try {
        const reply = await runLab(
          { query: trimmed, ...parseFilter(chosen), k, constant },
          abort.signal,
        );
        setResult(reply);
        setOpen(null);
        setHot(null);
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") return;
        setError(
          errorMessage(
            cause,
            "The search modes couldn't be compared. Try again.",
          ),
        );
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setRunning(false);
        }
      }
    },
    [k, constant],
  );

  // A link with a query runs it once the library is known.
  useEffect(() => {
    if (linkRan.current || !linkedQuery.query || !library) return;
    const timer = window.setTimeout(() => {
      linkRan.current = true;
      void run(linkedQuery.query, filter);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [library, linkedQuery, filter, run]);

  useEffect(
    () => () => {
      controller.current?.abort();
      // Forget the pending frame too, or a remount would never measure again.
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  const pick = (labelledQuery: LabelledQuery) => {
    const chosen = filterValue(labelledQuery.model, labelledQuery.revision);
    setQueryDraft(labelledQuery.query);
    setFilterChoice(chosen);
    void run(labelledQuery.query, chosen);
  };

  // ------------------------------------------------------------ the lists

  const fused = useMemo<LabFused[]>(
    () =>
      result
        ? fuse(
            [
              result.keyword.results.map((r) => r.id),
              result.semantic.results.map((r) => r.id),
            ],
            constant,
          )
        : [],
    [result, constant],
  );

  const lists = useMemo<Record<Column, string[]>>(
    () => ({
      keyword: result ? result.keyword.results.map((r) => r.id) : [],
      hybrid: fused.map((entry) => entry.id),
      semantic: result ? result.semantic.results.map((r) => r.id) : [],
    }),
    [result, fused],
  );

  const ranks = useMemo(() => {
    const table = {} as Record<Column, Map<string, number>>;
    for (const column of COLUMNS)
      table[column] = new Map(lists[column].map((id, i) => [id, i + 1]));
    return table;
  }, [lists]);

  const shown = useMemo(() => {
    const table = {} as Record<Column, string[]>;
    for (const column of COLUMNS)
      table[column] = lists[column].slice(0, depthCount);
    return table;
  }, [lists, depthCount]);

  const keywordHits = useMemo(
    () => new Map(result?.keyword.results.map((r) => [r.id, r]) ?? []),
    [result],
  );
  const semanticHits = useMemo(
    () => new Map(result?.semantic.results.map((r) => [r.id, r]) ?? []),
    [result],
  );
  const fusedById = useMemo(
    () => new Map(fused.map((entry) => [entry.id, entry])),
    [fused],
  );

  // The passages each tied passage shares its exact score with.
  const tieMates = useMemo(() => {
    const groups = new Map<string, LabFused[]>();
    for (const entry of fused) {
      if (!entry.tied) continue;
      const key = exactScore(entry.ranks, constant);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const mates = new Map<string, LabFused[]>();
    for (const group of groups.values())
      for (const entry of group)
        mates.set(
          entry.id,
          group.filter((other) => other !== entry),
        );
    return mates;
  }, [fused, constant]);

  const docModels = useMemo(
    () => new Map(library?.documents.map((d) => [d.id, d.models]) ?? []),
    [library],
  );

  // The filter's models, grouped by family as the model picker groups them.
  const filterGroups = useMemo(() => {
    const groups: { label: string; models: LibraryModel[] }[] = [];
    for (const model of library?.models ?? []) {
      const label =
        library?.families.find((family) => family.id === model.family)?.name ??
        "Other models";
      const group = groups.find((g) => g.label === label);
      if (group) group.models.push(model);
      else groups.push({ label, models: [model] });
    }
    return groups;
  }, [library]);

  // ------------------------------------------------------------ lines

  const measure = useCallback(() => {
    frame.current = 0;
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const rects = COLUMNS.map((column) =>
      columnEls.current.get(column)?.getBoundingClientRect(),
    );
    // Lines only make sense while the columns stand side by side.
    const sideBySide = rects.every(
      (rect, index) =>
        rect !== undefined &&
        rect.width > 0 &&
        (index === 0 || rect.left >= (rects[index - 1]?.right ?? 0) - 1),
    );
    if (!sideBySide) {
      setAnchors(null);
      return;
    }
    const next: Anchors = {};
    cardEls.current.forEach((element, key) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      next[key] = {
        left: half(rect.left - box.left),
        right: half(rect.right - box.left),
        y: half(rect.top - box.top + Math.min(ANCHOR_Y, rect.height / 2)),
      };
    });
    setAnchors((previous) =>
      previous && sameAnchors(previous, next) ? previous : next,
    );
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(measure);
  }, [measure]);

  const register = useCallback((key: string, element: HTMLElement | null) => {
    if (element) cardEls.current.set(key, element);
    else cardEls.current.delete(key);
  }, []);

  // Anything that moves a card moves its lines.
  useLayoutEffect(() => {
    scheduleMeasure();
  }, [scheduleMeasure, shown, open, k, active, result]);

  // So do fonts arriving, the window resizing and a passage opening.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(stage);
    columnEls.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [scheduleMeasure, result]);

  const drawing = useMemo(() => {
    const wires: Wire[] = [];
    const stubs: Stub[] = [];
    if (!anchors) return { wires, stubs };
    for (const [left, right] of PAIRS) {
      for (const id of shown[left]) {
        const from = anchors[`${left}|${id}`];
        const rightRank = ranks[right].get(id);
        if (!from || rightRank === undefined) continue;
        const leftRank = ranks[left].get(id) ?? Number.POSITIVE_INFINITY;
        if (rightRank <= depthCount) {
          const to = anchors[`${right}|${id}`];
          if (!to) continue;
          const mid = (from.right + to.left) / 2;
          wires.push({
            key: `${left}-${right}|${id}`,
            id,
            d: `M ${from.right} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.left} ${to.y}`,
            within: leftRank <= k && rightRank <= k,
          });
        } else {
          stubs.push({
            key: `${left}>${right}|${id}`,
            id,
            d: `M ${from.right} ${from.y} h 9`,
            x: from.right + 12,
            y: from.y + 3.5,
            label: `${LETTER[right]}${rightRank}`,
            anchor: "start",
          });
        }
      }
      for (const id of shown[right]) {
        const leftRank = ranks[left].get(id);
        const to = anchors[`${right}|${id}`];
        if (!to || leftRank === undefined || leftRank <= depthCount) continue;
        stubs.push({
          key: `${right}<${left}|${id}`,
          id,
          d: `M ${to.left} ${to.y} h -9`,
          x: to.left - 12,
          y: to.y + 3.5,
          label: `${LETTER[left]}${leftRank}`,
          anchor: "end",
        });
      }
    }
    return { wires, stubs };
  }, [anchors, shown, ranks, depthCount, k]);

  // ------------------------------------------------------------ what the run was

  const focusId = hot ?? open?.id ?? null;
  const tone = (id: string) =>
    focusId === null ? "" : id === focusId ? styles.hot : styles.dim;

  const resultFilter = result
    ? filterValue(result.filter.model, result.filter.revision)
    : "";
  const stale =
    !!result && (query.trim() !== result.query || filter !== resultFilter);
  const filterModel = modelById(result?.filter.model);
  const filterRevision = filterModel?.revisions.find(
    (r) => r.id === result?.filter.revision,
  );
  const labelledMatch =
    result?.queryId && labelled
      ? (labelled.find((q) => q.id === result.queryId) ?? null)
      : null;
  // With no filter, chips are greyed against the model in question: the
  // labelled query's, else the one being worked on.
  const referenceSource: "labelled" | "working" | null =
    !result || result.filter.model
      ? null
      : labelledMatch?.model
        ? "labelled"
        : selection.model
          ? "working"
          : null;
  const reference =
    referenceSource === "labelled"
      ? (labelledMatch?.model ?? null)
      : referenceSource === "working"
        ? selection.model
        : null;
  const referenceModel = modelById(reference);
  const anyTie = fused.some((entry) => entry.tied);

  const columnHead = (column: Column): ReactNode => {
    if (!result) return null;
    if (column === "keyword")
      return (
        <>
          <p className={styles.columnNote}>
            BM25 over the manuals&rsquo; words. Higher scores match more of the
            query, and rarer words count for more.
          </p>
          {result.keyword.terms.length > 0 && (
            <span className={styles.queryTerms}>
              <span className="sr-only">Query words: </span>
              {result.keyword.terms.map((term) => (
                <span key={term} className={`chip tiny flat ${styles.term}`}>
                  {term}
                </span>
              ))}
            </span>
          )}
        </>
      );
    if (column === "semantic")
      return result.semantic.available ? (
        <p className={styles.columnNote}>
          Cosine similarity between the meaning of the query and of each passage
          {result.semantic.model ? `, by ${result.semantic.model}` : ""}. Closer
          to 1 is nearer.
        </p>
      ) : (
        <Alert tone="warn">
          <strong>Semantic search didn&rsquo;t run.</strong>{" "}
          {result.semantic.reason ?? ""}
          {health?.embeddings.status === "loading" &&
            " The embedding model is still loading; run again in a moment."}
          {health?.embeddings.status === "failed" &&
            " The embedding model failed to load on this server."}
        </Alert>
      );
    return (
      <>
        <p className={styles.columnNote}>
          Reciprocal rank fusion at constant {constant}
          {constant !== result.constant
            ? `, re-fused in your browser (the server ran at ${result.constant})`
            : ""}
          .
          {!result.semantic.available &&
            " With no semantic list, this is the keyword list on its own."}
        </p>
        {anyTie && (
          <p className={styles.columnNote}>
            <span className="chip tiny warn">Tie</span> Same score as another
            passage. {TIE_RULE}
          </p>
        )}
      </>
    );
  };

  const figuresFor = (column: Column, id: string): ReactNode => {
    if (!result) return null;
    if (column === "keyword") {
      const hit = keywordHits.get(id);
      return hit ? (
        <KeywordFigures hit={hit} queryTerms={result.keyword.terms.length} />
      ) : null;
    }
    if (column === "semantic") {
      const hit = semanticHits.get(id);
      return hit ? <SemanticFigures hit={hit} /> : null;
    }
    const entry = fusedById.get(id);
    return entry ? (
      <HybridFigures
        entry={entry}
        constant={constant}
        mates={tieMates.get(id) ?? []}
      />
    ) : null;
  };

  const emptyText: Record<Column, string> = {
    keyword: "No passage contains a word of the query.",
    hybrid: "Neither list returned a passage, so there is nothing to fuse.",
    semantic: result?.semantic.available
      ? "No passage was returned."
      : "No semantic list for this run.",
  };

  // ------------------------------------------------------------ render

  return (
    <div className={`stack ${styles.root}`}>
      <PageHead eyebrow="Lab" title="Search modes" aside={<SemanticStatus />}>
        One query through keyword, semantic and hybrid search, with the same
        model filter, side by side. Nothing here is written by a model: these
        are the rankings themselves.
      </PageHead>

      {!online && (
        <Alert tone="bad">
          The Finder backend isn&rsquo;t reachable, so nothing can be searched.
          It may still be starting; try again in a moment.
        </Alert>
      )}
      {libraryError && <Alert tone="bad">{libraryError}</Alert>}
      {noManuals && (
        <Alert tone="warn">
          There are no manuals to search yet. Add the sample library or your own
          manuals on the <Link href="/library">Library</Link> page.
        </Alert>
      )}

      <form
        className={`panel ${styles.form}`}
        aria-label="Compare search modes"
        onSubmit={(event) => {
          event.preventDefault();
          void run(query, filter);
        }}
      >
        <div className={styles.queryRow}>
          <label className={styles.queryLabel} htmlFor={SEARCH_INPUT_ID}>
            Query
          </label>
          <div className="field field-lg">
            <Search size={20} aria-hidden />
            <input
              id={SEARCH_INPUT_ID}
              value={query}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="A fault code, a symptom or a question"
              maxLength={4000}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className={styles.controls}>
          <label className={`label ${styles.controlLabel}`}>
            Filter
            <span className="field">
              <select
                value={filter}
                onChange={(event) => setFilterChoice(event.target.value)}
              >
                <option value="">
                  No filter: every model&rsquo;s passages
                </option>
                {filterGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((model) => (
                      <Fragment key={model.id}>
                        <option value={model.id}>
                          {model.name} ({model.short})
                        </option>
                        {model.revisions.map((revision) => (
                          <option
                            key={revision.id}
                            value={filterValue(model.id, revision.id)}
                          >
                            {model.name}, revision {revision.label}
                          </option>
                        ))}
                      </Fragment>
                    ))}
                  </optgroup>
                ))}
              </select>
            </span>
          </label>
          <label className={`label ${styles.controlLabel}`}>
            Top k
            <span className={`field ${styles.numberField}`}>
              <WholeNumber
                value={k}
                range={K_RANGE}
                onChange={(value) => setKChoice(value)}
                describedBy="lab-k-hint"
              />
            </span>
          </label>
          <button
            type="submit"
            className={`btn primary ${styles.run}`}
            disabled={running || !query.trim() || !online || noManuals}
          >
            {running ? (
              <LoaderCircle size={17} className="spin" aria-hidden />
            ) : (
              <Play size={17} aria-hidden />
            )}
            Run
          </button>
        </div>
        <p className="hint" id="lab-k-hint">
          Each list holds up to {health?.retrieval.candidates ?? 20} candidates;
          k only moves the line that marks what would be used.
        </p>

        <fieldset className={styles.constant}>
          <legend>RRF constant</legend>
          <div className={styles.constantRow}>
            <div className={styles.slider}>
              <input
                type="range"
                className="slider"
                min={CONSTANT_RANGE[0]}
                max={SLIDER_MAX}
                step={1}
                value={Math.min(constant, SLIDER_MAX)}
                onChange={(event) =>
                  setConstantChoice(Number(event.target.value))
                }
                aria-label="RRF constant"
                aria-describedby="lab-constant-hint"
              />
              <span className={styles.scale} aria-hidden>
                <span>1</span>
                <span>{SLIDER_MAX}</span>
              </span>
            </div>
            <span className={`field ${styles.numberField}`}>
              <WholeNumber
                value={constant}
                range={CONSTANT_RANGE}
                onChange={(value) => setConstantChoice(value)}
                label="RRF constant, exact value (1 to 1000)"
                describedBy="lab-constant-hint"
              />
            </span>
            <button
              type="button"
              className="btn quiet small"
              onClick={() => setConstantChoice(null)}
              disabled={constant === savedConstant}
            >
              <RotateCcw size={14} aria-hidden /> Reset to {savedConstant}
            </button>
          </div>
          <p className="hint" id="lab-constant-hint">
            Moving it re-fuses the hybrid column in your browser; the server
            isn&rsquo;t asked again. {savedConstant} is your workspace&rsquo;s
            setting, which Search uses; changing it here leaves that alone.
            {constant > SLIDER_MAX &&
              ` Above ${SLIDER_MAX}, set it in the number field.`}
          </p>
        </fieldset>

        {labelled &&
          labelled.length > 0 &&
          library &&
          (library.sample.loaded ? (
            <details className={styles.picks} open>
              <summary>
                Labelled queries
                <span className="hint">
                  Picking one fills the query and its model, then runs it.
                </span>
              </summary>
              <div
                className={styles.pickList}
                role="group"
                aria-label="Labelled queries"
              >
                {labelled.map((labelledQuery) => {
                  const model = modelById(labelledQuery.model);
                  const revision = model?.revisions.find(
                    (r) => r.id === labelledQuery.revision,
                  );
                  const missing = !!labelledQuery.model && !model;
                  const value = filterValue(
                    labelledQuery.model,
                    labelledQuery.revision,
                  );
                  return (
                    <button
                      key={labelledQuery.id}
                      type="button"
                      className={`chip ${styles.pick}`}
                      aria-pressed={
                        query.trim() === labelledQuery.query && filter === value
                      }
                      disabled={missing || !online}
                      title={
                        missing
                          ? "Its model isn't in this library."
                          : labelledQuery.note
                      }
                      onClick={() => pick(labelledQuery)}
                    >
                      <span className={styles.pickId}>{labelledQuery.id}</span>
                      <span className={styles.pickModel}>
                        {model
                          ? `${model.short}${revision ? ` ${revision.label}` : ""}`
                          : labelledQuery.model
                            ? labelledQuery.model
                            : "No model"}
                      </span>
                      <span className={styles.pickText}>
                        {labelledQuery.query}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          ) : (
            <p className="hint">
              The labelled queries are about the sample library, which
              isn&rsquo;t loaded in this workspace.{" "}
              <Link href="/library">Load it on the Library page</Link> to use
              them here.
            </p>
          ))}
      </form>

      <Explainer constant={constant} />

      {error && <Alert tone="bad">{error}</Alert>}
      <p className="sr-only" aria-live="polite">
        {running
          ? "Comparing the search modes…"
          : result
            ? `Compared: ${plural(lists.keyword.length, "keyword passage")}, ${plural(lists.semantic.length, "semantic passage")}, ${plural(lists.hybrid.length, "fused passage")}.`
            : ""}
      </p>

      {result && (
        <section
          className={`stack ${styles.results}`}
          aria-labelledby="lab-results-title"
          aria-busy={running}
        >
          <div className={styles.summary}>
            <div className={styles.summaryHead}>
              <h2 id="lab-results-title">Results</h2>
              <span className="small muted">
                {plural(lists.keyword.length, "keyword passage")} ·{" "}
                {plural(lists.semantic.length, "semantic passage")} ·{" "}
                {plural(lists.hybrid.length, "fused passage")} · ran in{" "}
                {formatMs(result.ms)}
              </span>
            </div>
            <div className={styles.facts}>
              <p className={styles.searched}>
                <span>
                  Searched for <q>{result.query}</q>
                </span>
                {result.readAs.map((code) => (
                  <span key={code} className="chip tiny accent">
                    Read as {code}
                  </span>
                ))}
              </p>
              <p>
                {result.filter.model ? (
                  <>
                    Filtered to{" "}
                    <strong>
                      {filterModel?.name ?? result.filter.model}
                      {result.filter.revision
                        ? `, revision ${filterRevision?.label ?? result.filter.revision}`
                        : ""}
                    </strong>
                    : {plural(result.filter.allowed, "passage")} searched,{" "}
                    {result.filter.excluded.toLocaleString("en")} set aside
                    before ranking.
                  </>
                ) : (
                  <>
                    <strong>No filter</strong>: all{" "}
                    {plural(result.filter.allowed, "passage")} searched,
                    whichever model they are for.{" "}
                    {referenceModel
                      ? `Chips for models other than the ${referenceModel.short} (${referenceSource === "labelled" ? "the labelled query's model" : "the model you're working on"}) are greyed, and passages that don't apply to it are hatched.`
                      : "Nothing is greyed: no model is in question."}
                  </>
                )}
              </p>
              {result.queryId && (
                <p>
                  This is labelled query{" "}
                  <span className="mono">{result.queryId}</span>
                  {labelledMatch?.model
                    ? ` (labelled for the ${modelById(labelledMatch.model)?.short ?? labelledMatch.model})`
                    : ""}
                  .{" "}
                  {result.expected.length
                    ? `Its expected ${result.expected.length === 1 ? "passage is" : "passages are"} marked Expected.`
                    : "Finder should ask which model, so no passage is expected."}
                  {labelledMatch &&
                    labelledMatch.model !== result.filter.model &&
                    ` This run used ${result.filter.model ? `the ${filterModel?.short ?? result.filter.model} filter` : "no filter"}, not its model.`}
                </p>
              )}
              {stale && (
                <p className={styles.stale}>
                  The query or filter has changed since this run. Run again to
                  update the columns.
                </p>
              )}
            </div>
          </div>

          <div className={styles.toolbar}>
            <div
              className={`seg ${styles.tabs}`}
              role="group"
              aria-label="Column to show"
            >
              {COLUMNS.map((column) => (
                <button
                  key={column}
                  type="button"
                  aria-pressed={active === column}
                  onClick={() => setActive(column)}
                >
                  {NAME[column]}{" "}
                  <span className="faint">{lists[column].length}</span>
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Passages to show">
              <button
                type="button"
                aria-pressed={depth === "top"}
                onClick={() => setDepth("top")}
              >
                Top {topCount}
              </button>
              <button
                type="button"
                aria-pressed={depth === "all"}
                onClick={() => setDepth("all")}
              >
                Every candidate
              </button>
            </div>
            <p className={`${styles.legend} ${styles.legendWide}`}>
              Lines join the same passage in neighbouring columns: solid when
              both ends are in the top {k}, dashed when one is beyond it. A
              short line with a label points to a rank further down.
            </p>
            <p className={`${styles.legend} ${styles.legendNarrow}`}>
              K, S and H give the passage&rsquo;s rank in the keyword, semantic
              and hybrid lists; a dash means that list didn&rsquo;t return it.
            </p>
          </div>

          <div className={styles.stage} ref={stageRef}>
            {anchors && (
              <svg
                className={styles.wires}
                aria-hidden="true"
                focusable="false"
              >
                {drawing.wires.map((wire) => (
                  <path
                    key={wire.key}
                    d={wire.d}
                    className={`${styles.wire} ${wire.within ? "" : styles.beyond} ${tone(wire.id)}`}
                  />
                ))}
                {drawing.stubs.map((stub) => (
                  <g key={stub.key}>
                    <path
                      d={stub.d}
                      className={`${styles.wire} ${styles.beyond} ${tone(stub.id)}`}
                    />
                    <text
                      x={stub.x}
                      y={stub.y}
                      textAnchor={stub.anchor}
                      className={`${styles.stubLabel} ${tone(stub.id)}`}
                    >
                      {stub.label}
                    </text>
                  </g>
                ))}
              </svg>
            )}
            {COLUMNS.map((column) => {
              const list = shown[column];
              const hidden = lists[column].length - list.length;
              return (
                <section
                  key={column}
                  ref={(element) => {
                    if (element) columnEls.current.set(column, element);
                    else columnEls.current.delete(column);
                  }}
                  className={styles.column}
                  data-active={active === column || undefined}
                  aria-labelledby={`lab-column-${column}`}
                >
                  <header className={styles.columnHead}>
                    <div className={styles.columnTitle}>
                      <h3 id={`lab-column-${column}`}>{NAME[column]}</h3>
                      <span className={styles.count}>
                        {plural(lists[column].length, "passage")}
                      </span>
                    </div>
                    {columnHead(column)}
                  </header>
                  {list.length ? (
                    <ol className={styles.list}>
                      {list.map((id, index) => {
                        const chunk = result.chunks[id];
                        return (
                          <Fragment key={id}>
                            {index === k && (
                              <li
                                className={styles.cut}
                                role="separator"
                                aria-label={`End of the top ${k}`}
                              >
                                Top {k} above
                              </li>
                            )}
                            <PassageCard
                              column={column}
                              id={id}
                              rank={index + 1}
                              chunk={chunk}
                              expected={result.expected.includes(id)}
                              open={open?.column === column && open.id === id}
                              linked={focusId === id}
                              other={
                                !!chunk &&
                                reference !== null &&
                                !appliesTo(
                                  chunk,
                                  reference,
                                  docModels.get(chunk.docId),
                                )
                              }
                              ranks={{
                                keyword: ranks.keyword.get(id),
                                hybrid: ranks.hybrid.get(id),
                                semantic: ranks.semantic.get(id),
                              }}
                              reference={reference}
                              docModels={
                                chunk ? docModels.get(chunk.docId) : undefined
                              }
                              terms={result.keyword.terms}
                              figures={figuresFor(column, id)}
                              onToggle={() =>
                                setOpen((current) =>
                                  current?.column === column &&
                                  current.id === id
                                    ? null
                                    : { column, id },
                                )
                              }
                              onHot={setHot}
                              register={register}
                            />
                          </Fragment>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className={`flat ${styles.empty}`}>
                      {emptyText[column]}
                    </p>
                  )}
                  {hidden > 0 && (
                    <button
                      type="button"
                      className={`btn quiet small ${styles.more}`}
                      onClick={() => setDepth("all")}
                    >
                      Show {hidden} more
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
