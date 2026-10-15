"use client";

import {
  ArrowUpRight,
  Check,
  CircleMinus,
  Download,
  Info,
  LoaderCircle,
  Play,
  Square,
  Trash,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteEvalRun,
  getEvalRun,
  getEvaluation,
  runEvaluation,
} from "@/lib/api";
import { plural } from "@/lib/text";
import type {
  ClarifyReason,
  EvalModeResult,
  EvalProgress,
  EvalRow,
  EvalRun,
  EvalRunSummary,
  EvaluationInfo,
  LabelledQuery,
  QueryKind,
  RetrievalMode,
} from "@/lib/types";
import { CodeDisplay } from "./code-display";
import { errorMessage, useFinder } from "./finder-provider";
import { SemanticStatus } from "./lab-view";
import { Alert, ModelChip, PageHead } from "./ui";
import styles from "./evaluate-view.module.css";

/**
 * The labelled queries (queries.json) through every search mode, as the
 * backend ran them: hits, ranks, passages from the wrong model, and whether
 * Finder asked when it should have. The page shows the numbers of a run and
 * its scope; it never names a winner.
 */

const MODES: RetrievalMode[] = ["keyword", "semantic", "hybrid"];
const MODE_NAME: Record<RetrievalMode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
};
const KIND: Record<QueryKind, string> = {
  exact_code: "Exact code",
  paraphrase: "Paraphrase",
  mixed: "Mixed",
  ambiguity: "Ambiguity",
};
const REASON: Record<ClarifyReason, string> = {
  no_model: "no model was chosen",
  ambiguous_name: "the name fits more than one model",
  conflict: "the question and the picker name different models",
  revision: "the answer depends on the revision",
};
const DATE = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

/** Save a run as a JSON file through a Blob link. */
function saveJson(data: unknown, name: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function runFileName(id: string): string {
  return `finder-run-${id}.json`;
}

function labHref(query: {
  query: string;
  model: string | null;
  revision: string | null;
}): string {
  const params = new URLSearchParams({ q: query.query });
  if (query.model) params.set("model", query.model);
  if (query.revision) params.set("revision", query.revision);
  return `/lab?${params}`;
}

function modesOf(run: EvalRun): RetrievalMode[] {
  return MODES.filter(
    (mode) =>
      run.totals[mode] !== undefined || run.rows.some((row) => row.modes[mode]),
  );
}

/** A model or revision ID as people read it, e.g. "3B+" or "3B BCM2837 (original)". */
function useChoiceLabel(): (id: string) => string {
  const { library } = useFinder();
  return useCallback(
    (id: string) => {
      const models = library?.models ?? [];
      const model = models.find((m) => m.id === id);
      if (model) return model.short;
      for (const owner of models) {
        const revision = owner.revisions.find((r) => r.id === id);
        if (revision) return `${owner.short} ${revision.label}`;
      }
      return id;
    },
    [library],
  );
}

// ---------------------------------------------------------------- small parts

function KindChip({ kind }: { kind: QueryKind }) {
  const tone =
    kind === "ambiguity" ? "warn" : kind === "exact_code" ? "accent" : "flat";
  return <span className={`chip tiny ${tone}`}>{KIND[kind] ?? kind}</span>;
}

function ModelLabel({
  model,
  revision,
}: {
  model: string | null;
  revision: string | null;
}) {
  const { modelById } = useFinder();
  if (!model) return <span className="chip tiny flat">No model chosen</span>;
  const found = modelById(model);
  const label = found?.revisions.find((r) => r.id === revision)?.label;
  return (
    <>
      <ModelChip model={found ?? { id: model, short: model, name: model }} />
      {revision && (
        <span className="chip tiny flat" title="Revision">
          {label ?? revision}
        </span>
      )}
    </>
  );
}

function Hit({ hit, children }: { hit: boolean; children?: string }) {
  return hit ? (
    <span className={styles.hit}>
      <Check size={14} strokeWidth={3} aria-hidden /> Hit{children}
    </span>
  ) : (
    <span className={styles.miss}>
      <CircleMinus size={14} aria-hidden /> Miss{children}
    </span>
  );
}

/** Passages from another model in the top k. With the filter on, it must be 0. */
function WrongModel({ count }: { count: number }) {
  if (count === 0) return <span className={styles.count}>0 wrong-model</span>;
  return (
    <span className={`${styles.count} ${styles.wrong}`}>
      <TriangleAlert size={13} aria-hidden /> {count} wrong-model
    </span>
  );
}

function ModeCell({
  result,
  filtered,
}: {
  result: EvalModeResult | undefined;
  filtered: boolean;
}) {
  if (!result)
    return (
      <td>
        <span className="faint" aria-hidden>
          —
        </span>
        <span className="sr-only">Not run</span>
      </td>
    );
  return (
    <td>
      <div className={styles.cell}>
        <Hit hit={result.hit}>
          {result.hit && result.rank !== null ? ` · rank ${result.rank}` : ""}
        </Hit>
        {filtered ? (
          <WrongModel count={result.wrongModel} />
        ) : (
          <span className={styles.count}>no model filter</span>
        )}
        {result.used !== result.mode && (
          <span className="chip tiny warn">ran as {result.used}</span>
        )}
      </div>
    </td>
  );
}

function LookupCell({ lookup }: { lookup: EvalRow["lookup"] }) {
  if (!lookup)
    return (
      <td>
        <span className="faint" aria-hidden>
          —
        </span>
        <span className="sr-only">No exact-code lookup for this query</span>
      </td>
    );
  return (
    <td>
      <div className={styles.cell}>
        <Hit hit={lookup.hit} />
        <CodeDisplay
          code={lookup.code}
          display={lookup.code}
          scheme="text"
          size="small"
        />
      </div>
    </td>
  );
}

/** An ambiguity query: did Finder ask, why, and were the right choices offered? */
function AskedCell({
  row,
  wanted,
  modes,
}: {
  row: EvalRow;
  wanted: string[] | undefined;
  modes: RetrievalMode[];
}) {
  const label = useChoiceLabel();
  const showMatched = row.reason === "no_model";
  return (
    <td colSpan={modes.length + 1}>
      <div className={styles.asked}>
        {row.asked ? (
          <span className={styles.hit}>
            <Check size={14} strokeWidth={3} aria-hidden /> Asked
          </span>
        ) : (
          <span className={styles.wrong}>
            <X size={14} aria-hidden /> Didn&rsquo;t ask
          </span>
        )}
        {row.reason && <span>Why: {REASON[row.reason] ?? row.reason}</span>}
        {row.candidatesOk === true && (
          <span className={styles.hit}>
            <Check size={14} strokeWidth={3} aria-hidden /> Expected choices
            offered
          </span>
        )}
        {row.candidatesOk === false && (
          <span className={styles.wrong}>
            <X size={14} aria-hidden /> Expected choices not offered
          </span>
        )}
      </div>
      {row.candidates.length > 0 && (
        <div className={styles.choices}>
          <span className="faint small">Offered</span>
          {row.candidates.map((id) => (
            <span
              key={id}
              className={`chip tiny ${wanted?.includes(id) ? "accent" : "flat"}`}
              title={
                row.matched.includes(id)
                  ? "Its manual has passages that match the question"
                  : undefined
              }
            >
              {label(id)}
              {showMatched && row.matched.includes(id) ? " · matched" : ""}
            </span>
          ))}
        </div>
      )}
      {wanted && wanted.length > 0 && (
        <p className={styles.small}>
          Expected among them{showMatched ? ", marked as matching" : ""}:{" "}
          {wanted.map(label).join(", ")}.
        </p>
      )}
      {row.model && (
        <p className={styles.small}>
          Wrong-model passages in the top k:{" "}
          {modes.map((mode, index) => {
            const count = row.modes[mode]?.wrongModel;
            return (
              <span key={mode}>
                {index > 0 && " · "}
                {MODE_NAME[mode]}{" "}
                {count === undefined ? (
                  "—"
                ) : count > 0 ? (
                  <strong className={styles.wrong}>{count}</strong>
                ) : (
                  count
                )}
              </span>
            );
          })}
        </p>
      )}
    </td>
  );
}

function Totals({ run, modes }: { run: EvalRun; modes: RetrievalMode[] }) {
  const lookalike = run.lookalike;
  return (
    <ul className={styles.tiles} aria-label="Totals">
      {modes.map((mode) => {
        const total = run.totals[mode];
        if (!total) return null;
        return (
          <li key={mode} className={`well ${styles.tile}`}>
            <span className={styles.tileLabel}>{MODE_NAME[mode]}:</span>
            <span className={styles.tileValue}>
              {total.hits} of {total.of}
            </span>
            <span className={styles.tileNote}>
              expected passage in the top {run.k}
            </span>
          </li>
        );
      })}
      <li className={`well ${styles.tile}`}>
        <span className={styles.tileLabel}>Exact-code lookup:</span>
        <span className={styles.tileValue}>
          {run.lookup.hits} of {run.lookup.of}
        </span>
        <span className={styles.tileNote}>
          read straight from the model&rsquo;s code tables
        </span>
      </li>
      {lookalike && (
        <li className={`well ${styles.tile}`}>
          <span className={styles.tileLabel}>Look-alike passages:</span>
          <span className={styles.tileValue}>
            {modes
              .map((mode) => lookalike.found[mode] ?? 0)
              .reduce((sum, count) => sum + count, 0)}
          </span>
          <span className={styles.tileNote}>
            labelled by hand for {lookalike.queries} questions, in any top{" "}
            {run.k}
          </span>
        </li>
      )}
      <li className={`well ${styles.tile}`}>
        <span className={styles.tileLabel}>Clarification:</span>
        <span className={styles.tileValue}>
          {run.clarification.asked} of {run.clarification.of}
        </span>
        <span className={styles.tileNote}>
          asked, with the expected choices
        </span>
      </li>
    </ul>
  );
}

function RunResults({
  run,
  queries,
  newest,
}: {
  run: EvalRun;
  queries: LabelledQuery[];
  newest: boolean;
}) {
  const modes = modesOf(run);
  const answering = run.rows.filter(
    (row) => row.expectStatus !== "clarification",
  );
  const asking = run.rows.length - answering.length;
  const fellBack = modes.filter((mode) =>
    run.rows.some((row) => {
      const result = row.modes[mode];
      return result !== undefined && result.used !== mode;
    }),
  );
  const wrongTotal = (mode: RetrievalMode) =>
    run.rows.reduce(
      (sum, row) => sum + (row.model ? (row.modes[mode]?.wrongModel ?? 0) : 0),
      0,
    );
  const wantedFor = (id: string) =>
    queries.find((q) => q.id === id)?.expectedCandidates;

  return (
    <section
      className={`stack ${styles.block}`}
      aria-labelledby="eval-results-title"
    >
      <div className={styles.resultsHead}>
        <div>
          <h2 id="eval-results-title">Results</h2>
          <p className="small muted">
            Run of {when(run.createdAt)}
            {newest ? " · the newest saved run" : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => saveJson(run, runFileName(run.id))}
        >
          <Download size={15} aria-hidden /> Download JSON
        </button>
      </div>

      <dl className={styles.meta}>
        <div>
          <dt>Top k</dt>
          <dd>{run.k}</dd>
        </div>
        <div>
          <dt>RRF constant</dt>
          <dd>{run.constant}</dd>
        </div>
        <div>
          <dt>Embedding model</dt>
          <dd>{run.embedder ?? "None: semantic search was off"}</dd>
        </div>
        <div>
          <dt>Corpus version</dt>
          <dd className="mono" title={run.corpusVersion}>
            {run.corpusVersion.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>Queries</dt>
          <dd>
            {run.rows.length}
            {queries.length > run.rows.length
              ? ` of ${queries.length}: the run stopped early`
              : ""}
          </dd>
        </div>
      </dl>

      <p className={styles.scope}>
        <Info size={17} aria-hidden />
        <span>{run.scope}</span>
      </p>
      {fellBack.length > 0 && (
        <Alert tone="warn">
          Semantic search didn&rsquo;t run, so{" "}
          {fellBack.map((mode) => MODE_NAME[mode].toLowerCase()).join(" and ")}{" "}
          {fellBack.length === 1 ? "is" : "are"} keyword search here, marked
          &ldquo;ran as keyword&rdquo;.
        </Alert>
      )}

      <Totals run={run} modes={modes} />

      <p className="hint">
        A hit means an expected passage is in the top {run.k} for that mode,
        searched with the query&rsquo;s model filter. Wrong-model counts top-
        {run.k} passages the tags give to another model, so it checks the
        filter, not the tags; look-alike passages are labelled by hand as
        another board&rsquo;s answer, so they check the tags too. The totals
        count the {answering.length}{" "}
        {answering.length === 1 ? "query that expects" : "queries that expect"}{" "}
        an answer
        {asking > 0
          ? `; the ${asking} that expect Finder to ask are counted under clarification.`
          : "."}
      </p>

      <div className="table-wrap">
        <table className={`table ${styles.results}`}>
          <caption className="sr-only">
            Results of each labelled query in each search mode
          </caption>
          <thead>
            <tr>
              <th scope="col">Query</th>
              {modes.map((mode) => (
                <th key={mode} scope="col">
                  {MODE_NAME[mode]}
                </th>
              ))}
              <th scope="col">Exact-code lookup</th>
            </tr>
          </thead>
          <tbody>
            {run.rows.map((row) => {
              const ambiguity = row.expectStatus === "clarification";
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <span className={styles.qhead}>
                      <span className={styles.qid}>{row.id}</span>
                      <KindChip kind={row.kind} />
                      <ModelLabel model={row.model} revision={row.revision} />
                    </span>
                    <span className={styles.qtext}>{row.query}</span>
                    {!ambiguity && row.asked && (
                      <span className="chip tiny warn">
                        Asked
                        {row.reason
                          ? `: ${REASON[row.reason] ?? row.reason}`
                          : ""}
                      </span>
                    )}
                    <Link href={labHref(row)} className={styles.labLink}>
                      Compare in the Lab <ArrowUpRight size={13} aria-hidden />
                    </Link>
                  </th>
                  {ambiguity ? (
                    <AskedCell
                      row={row}
                      wanted={wantedFor(row.id)}
                      modes={modes}
                    />
                  ) : (
                    <>
                      {modes.map((mode) => (
                        <ModeCell
                          key={mode}
                          result={row.modes[mode]}
                          filtered={!!row.model}
                        />
                      ))}
                      <LookupCell lookup={row.lookup} />
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totals</th>
              {modes.map((mode) => {
                const total = run.totals[mode];
                return (
                  <td key={mode}>
                    <div className={styles.cell}>
                      <span>
                        {MODE_NAME[mode]}:{" "}
                        {total ? `${total.hits} of ${total.of}` : "—"}
                      </span>
                      <WrongModel count={wrongTotal(mode)} />
                    </div>
                  </td>
                );
              })}
              <td>
                Lookup: {run.lookup.hits} of {run.lookup.of}
              </td>
            </tr>
            <tr>
              <th scope="row">Clarification</th>
              <td colSpan={modes.length + 1}>
                Asked, with the expected choices: {run.clarification.asked} of{" "}
                {run.clarification.of}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RunItem({
  summary,
  queryCount,
  current,
  opening,
  confirming,
  busy,
  onView,
  onDownload,
  onAskDelete,
  onDelete,
  onKeep,
}: {
  summary: EvalRunSummary;
  /** How many labelled queries there are, to mark a run that stopped early. */
  queryCount: number;
  current: boolean;
  opening: boolean;
  confirming: boolean;
  busy: boolean;
  onView: () => void;
  onDownload: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const date = when(summary.createdAt);
  const totals = MODES.flatMap((mode) => {
    const total = summary.totals[mode];
    return total ? [`${MODE_NAME[mode]} ${total.hits}/${total.of}`] : [];
  });
  // Every mode counts the same answerable queries; the rest are the asking ones.
  const ran =
    (MODES.map((mode) => summary.totals[mode]?.of).find(
      (of) => of !== undefined,
    ) ?? 0) + summary.clarification.of;
  const partial = queryCount > 0 && ran < queryCount;
  return (
    <li className={styles.runItem} data-current={current || undefined}>
      <div className={styles.runInfo}>
        <strong>{date}</strong>
        <span className="small muted">
          k {summary.k} · constant {summary.constant} ·{" "}
          {summary.embedder ?? "no embedding model"}
          {partial ? ` · stopped early: ${ran} of ${queryCount} queries` : ""}
        </span>
        <span className={styles.runTotals}>
          {[
            ...totals,
            `Lookup ${summary.lookup.hits}/${summary.lookup.of}`,
            `Asked ${summary.clarification.asked}/${summary.clarification.of}`,
          ].join(" · ")}
        </span>
      </div>
      <div className={styles.runActions}>
        <button
          type="button"
          className={`btn small ${styles.viewButton}`}
          aria-pressed={current}
          disabled={opening}
          onClick={onView}
        >
          {opening && <LoaderCircle size={14} className="spin" aria-hidden />}
          {current ? "Showing" : "View"}
        </button>
        <button
          type="button"
          className="btn quiet small"
          onClick={onDownload}
          aria-label={`Download the run of ${date} as ${runFileName(summary.id)}`}
        >
          <Download size={14} aria-hidden /> JSON
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="btn small danger"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash size={14} aria-hidden /> Delete this run
            </button>
            <button type="button" className="btn quiet small" onClick={onKeep}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn quiet small danger"
            onClick={onAskDelete}
            aria-label={`Delete the run of ${date}`}
          >
            <Trash size={14} aria-hidden /> Delete
          </button>
        )}
      </div>
    </li>
  );
}

function QueryCard({ query }: { query: LabelledQuery }) {
  const label = useChoiceLabel();
  return (
    <li className={`flat ${styles.query}`}>
      <span className={styles.qhead}>
        <span className={styles.qid}>{query.id}</span>
        <KindChip kind={query.kind} />
        <ModelLabel model={query.model} revision={query.revision} />
      </span>
      <p className={styles.queryText}>{query.query}</p>
      {query.expectStatus === "clarification" ? (
        <p className={styles.expected}>
          <span>
            <span className={styles.label}>Expected: </span>Finder asks which
            {query.expectedCandidates?.length
              ? `, offering ${query.expectedCandidates.map(label).join(" and ")}`
              : ""}
            .
          </span>
        </p>
      ) : (
        <div className={styles.expected}>
          <span className={styles.label}>
            Expected {query.expected.length === 1 ? "passage" : "passages"}
          </span>
          {query.expected.map((id) => (
            <code key={id}>{id}</code>
          ))}
        </div>
      )}
      <p className={styles.note}>{query.note}</p>
      <Link
        href={labHref(query)}
        className={`btn quiet small ${styles.queryFoot}`}
      >
        Compare in the Lab <ArrowUpRight size={14} aria-hidden />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------- the page

export function EvaluateView() {
  const { health, library, libraryError, settings } = useFinder();
  const [info, setInfo] = useState<EvaluationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<EvalProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const online = health !== null;

  // The queries and the saved runs; the newest run is shown straight away.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    getEvaluation()
      .then(async (next) => {
        if (cancelled) return;
        setInfo(next);
        setLoadError(null);
        const newest = next.runs[0];
        if (!newest) return;
        try {
          const found = await getEvalRun(newest.id);
          if (!cancelled) setRun((current) => current ?? found);
        } catch {
          // The list still offers it; opening it again shows the problem.
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setLoadError(
            errorMessage(cause, "The labelled queries couldn't be loaded."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = controller.current;
      controller.current = null;
      current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setInfo(await getEvaluation());
    } catch {
      // Keep what is shown.
    }
  }, []);

  // A stopped run is still saved: the server finishes the query in hand,
  // then keeps what ran. Look again until it appears.
  const awaitSaved = useCallback(async (previous: string | undefined) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      if (!alive.current) return;
      try {
        const next = await getEvaluation();
        setInfo(next);
        if (next.runs[0]?.id !== previous) return;
      } catch {
        return;
      }
    }
  }, []);

  const start = async () => {
    const previous = info?.runs[0]?.id;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setProblem(null);
    setNotice(null);
    setProgress(null);
    setConfirming(null);
    try {
      const fresh = await runEvaluation({}, setProgress, abort.signal);
      setRun(fresh);
      setNotice(
        `Finished: ${plural(fresh.rows.length, "query", "queries")} run and saved.`,
      );
      await refresh();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") {
        // Stopped here, not by leaving the page.
        if (controller.current === abort) {
          setNotice(
            "Stopped. The queries that had already run are saved as a partial run.",
          );
          await awaitSaved(previous);
        }
      } else {
        setProblem(
          errorMessage(cause, "The queries couldn't be run. Try again."),
        );
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const view = async (id: string) => {
    if (run?.id === id) return;
    setOpening(id);
    setProblem(null);
    try {
      setRun(await getEvalRun(id));
    } catch (cause) {
      setProblem(errorMessage(cause, "This run couldn't be opened."));
    } finally {
      setOpening(null);
    }
  };

  const download = async (id: string) => {
    setProblem(null);
    try {
      saveJson(run?.id === id ? run : await getEvalRun(id), runFileName(id));
    } catch (cause) {
      setProblem(errorMessage(cause, "This run couldn't be downloaded."));
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    setProblem(null);
    try {
      await deleteEvalRun(id);
      setInfo((current) =>
        current
          ? { ...current, runs: current.runs.filter((r) => r.id !== id) }
          : current,
      );
      setRun((current) => (current?.id === id ? null : current));
      setNotice("Run deleted.");
    } catch (cause) {
      setProblem(errorMessage(cause, "This run couldn't be deleted."));
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  const sample = library?.sample;
  const queries = info?.queries ?? [];
  const runs = info?.runs ?? [];
  const canRun = online && !running && !!sample?.loaded && queries.length > 0;
  const total = progress?.total ?? queries.length;
  const done = progress?.done ?? 0;
  const status = running
    ? progress
      ? progress.query !== undefined
        ? `Running ${Math.min(done + 1, total)} of ${total}: ${progress.query}`
        : `Ran ${done} of ${total}. Saving the run…`
      : "Starting…"
    : (notice ?? "");
  const k = settings?.settings.k;
  const constant = settings?.settings.rrfConstant;

  return (
    <div className={`stack ${styles.root}`}>
      <PageHead
        eyebrow="Evaluate"
        title="Labelled queries"
        aside={<SemanticStatus />}
      >
        Questions about the sample library with known answers, each run through
        keyword, semantic and hybrid search with its model filter. This page
        reports what happened in a run; it doesn&rsquo;t pick a winner.
      </PageHead>

      {!online && (
        <Alert tone="bad">
          The Finder backend isn&rsquo;t reachable, so the queries can&rsquo;t
          be loaded or run. It may still be starting; this page loads them as
          soon as it answers.
        </Alert>
      )}
      {libraryError && <Alert tone="bad">{libraryError}</Alert>}
      {loadError && <Alert tone="bad">{loadError}</Alert>}
      {library && sample && !sample.available && (
        <Alert tone="warn">
          The sample library isn&rsquo;t available on this server, so the
          labelled queries can&rsquo;t be run here.
        </Alert>
      )}
      {library && sample?.available && !sample.loaded && (
        <Alert tone="warn">
          The sample library isn&rsquo;t loaded in this workspace, and the
          labelled queries are about its manuals.{" "}
          <Link href="/library">Load it on the Library page</Link>, then come
          back to run them.
        </Alert>
      )}

      <section
        className={`panel ${styles.runPanel}`}
        aria-labelledby="eval-run-title"
      >
        <div className={styles.runHead}>
          <div className={styles.runText}>
            <h2 id="eval-run-title">Run the queries</h2>
            <p>
              Runs {queries.length ? `all ${queries.length}` : "the"} labelled
              queries in each search mode with your workspace&rsquo;s settings
              {k !== undefined && constant !== undefined
                ? `: the top ${k} passages, RRF constant ${constant}`
                : ""}
              . Change them in <Link href="/settings">Settings</Link>. Each run
              is saved here.
            </p>
          </div>
          <div className={styles.actions}>
            {running ? (
              <button
                type="button"
                className="btn"
                onClick={() => controller.current?.abort()}
              >
                <Square size={15} aria-hidden /> Stop
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={!canRun}
              onClick={() => void start()}
            >
              {running ? (
                <LoaderCircle size={17} className="spin" aria-hidden />
              ) : (
                <Play size={17} aria-hidden />
              )}
              Run the queries
            </button>
          </div>
        </div>
        {running && (
          <div className={styles.progress}>
            <div
              className={styles.track}
              role="progressbar"
              aria-label="Labelled queries run"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
            >
              <span
                className={styles.fill}
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
        <p className={styles.live} aria-live="polite">
          {status}
        </p>
        {problem && <Alert tone="bad">{problem}</Alert>}
      </section>

      {run ? (
        <RunResults
          run={run}
          queries={queries}
          newest={runs[0]?.id === run.id}
        />
      ) : (
        info &&
        runs.length === 0 &&
        !running && (
          <p className="muted">
            No run yet. Run the queries to see how each search mode does on
            them.
          </p>
        )
      )}

      <section
        className={`stack-sm ${styles.block}`}
        aria-labelledby="eval-runs-title"
      >
        <h2 id="eval-runs-title">Saved runs</h2>
        {!info && !loadError ? (
          <div className={styles.loading} role="status">
            <span className="sr-only">Loading the saved runs…</span>
            <div className={`skeleton ${styles.skeletonLine}`} aria-hidden />
            <div className={`skeleton ${styles.skeletonLine}`} aria-hidden />
          </div>
        ) : runs.length === 0 ? (
          <p className="muted small">
            None yet. Finder keeps the newest 20 runs of this workspace.
          </p>
        ) : (
          <ul className={styles.runs}>
            {runs.map((summary) => (
              <RunItem
                key={summary.id}
                summary={summary}
                queryCount={queries.length}
                current={run?.id === summary.id}
                opening={opening === summary.id}
                confirming={confirming === summary.id}
                busy={deleting === summary.id}
                onView={() => void view(summary.id)}
                onDownload={() => void download(summary.id)}
                onAskDelete={() => setConfirming(summary.id)}
                onDelete={() => void remove(summary.id)}
                onKeep={() => setConfirming(null)}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        className={`stack-sm ${styles.block}`}
        aria-labelledby="eval-queries-title"
      >
        <h2 id="eval-queries-title">The labelled queries</h2>
        <p className="muted small">
          Each names the model a support agent would have chosen (none for the
          ambiguity cases), the passages that answer it, and why it is a fair
          test.
        </p>
        {!info && !loadError ? (
          <div className={styles.loading} role="status">
            <span className="sr-only">Loading the labelled queries…</span>
            <div className={`skeleton ${styles.skeletonLine}`} aria-hidden />
            <div className={`skeleton ${styles.skeletonLine}`} aria-hidden />
            <div className={`skeleton ${styles.skeletonLine}`} aria-hidden />
          </div>
        ) : queries.length === 0 ? (
          <p className="muted small">This server has no labelled queries.</p>
        ) : (
          <ol className={styles.queries}>
            {queries.map((query) => (
              <QueryCard key={query.id} query={query} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
