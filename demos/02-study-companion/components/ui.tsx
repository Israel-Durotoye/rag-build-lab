"use client";

import {
  AlertCircle,
  BookOpenText,
  Check,
  ChevronDown,
  FileText,
  FlaskConical,
  Loader2,
  MessagesSquare,
  ScanText,
  Sparkles,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { markFragment, plural } from "@/lib/text";
import type {
  Budget,
  Caveat,
  ContextItem,
  Section,
  TurnStatus,
  UploadStage,
} from "@/lib/types";
import { useStudy } from "./study-provider";

export const STATUS_TEXT: Record<TurnStatus, string> = {
  answered: "Explained from your notes, with the sections behind it.",
  not_found: "Your notes don't cover this.",
  uncited:
    "This explanation doesn't cite a section, so check any facts in it against your notes.",
  no_passages:
    "Insufficient evidence: nothing in your notes matches this question. Try other words, or add the notes that cover it.",
  interrupted: "The explanation stopped partway through.",
  unavailable:
    "The model couldn't be reached, so here are your notes' own sentences.",
  sources_only:
    "No model key is configured, so here are your notes' own sentences.",
};

export const CHUNKING_LABEL = {
  section: "Section-aware",
  fixed: "Fixed-length",
} as const;

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

const LAYERS = [
  { href: "/how-it-works", label: "Overview" },
  { href: "/retrieval", label: "1 · Retrieval" },
  { href: "/context", label: "2 · Context" },
  { href: "/generation", label: "3 · Generation" },
];

export function LayerNav() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="How it works">
      {LAYERS.map((layer) => (
        <Link
          key={layer.href}
          href={layer.href}
          aria-current={pathname === layer.href ? "page" : undefined}
        >
          {layer.label}
        </Link>
      ))}
    </nav>
  );
}

export function LayerIntro({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <LayerNav />
      <PageHead eyebrow={`Step ${step}`} title={title} aside={<TurnPicker />}>
        {children}
      </PageHead>
    </>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Picks which question the inspection pages explain. */
export function TurnPicker() {
  const { turns, inspected, inspect } = useStudy();
  if (turns.length < 2 || !inspected) return null;
  return (
    <label className="field field-inline">
      <span>Showing</span>
      <select
        value={inspected.id}
        onChange={(event) => inspect(event.target.value)}
      >
        {turns.map((turn, index) => (
          <option key={turn.id} value={turn.id}>
            {index + 1}. {turn.question.slice(0, 80)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NoTurnYet({ layer }: { layer: string }) {
  return (
    <div className="empty">
      <MessagesSquare size={26} aria-hidden />
      <h2>Ask a question first</h2>
      <p>
        This page shows what the {layer} step did for a question. Ask something
        on the Ask page, then come back here.
      </p>
      <Link href="/ask" className="button">
        Go to Ask
      </Link>
    </div>
  );
}

export function NoNotesYet({ what }: { what: string }) {
  return (
    <div className="empty">
      <BookOpenText size={26} aria-hidden />
      <h2>Add some notes first</h2>
      <p>
        {what} Add your own notes, or start with the sample notes on control
        systems.
      </p>
      <div className="row">
        <Link href="/notes" className="button">
          Add notes
        </Link>
        <SampleButton quiet />
      </div>
    </div>
  );
}

/** How much of the word budget the context used. */
export function BudgetMeter({ budget }: { budget: Budget }) {
  const share = Math.min(100, (budget.usedWords / budget.budgetWords) * 100);
  return (
    <div className="meter" data-over={budget.overBudget || undefined}>
      <div
        className="meter-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget.budgetWords}
        aria-valuenow={budget.usedWords}
        aria-label="Context words used"
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <p>
        <strong>{budget.usedWords.toLocaleString("en")}</strong> of{" "}
        {budget.budgetWords.toLocaleString("en")} words
        {budget.overBudget && " — the top match alone is over the budget"}
        {budget.skipped.length > 0 &&
          ` · ${plural(budget.skipped.length, "match", "matches")} left out`}
      </p>
    </div>
  );
}

export function Caveats({ caveats }: { caveats: Caveat[] }) {
  if (!caveats.length) return null;
  return (
    <aside className="caveats" aria-label="Caveats in your notes">
      <p className="caveats-title">
        <AlertCircle size={14} aria-hidden /> Watch for — in your notes&rsquo;
        own words
      </p>
      <ul>
        {caveats.map((caveat) => (
          <li key={`${caveat.n}-${caveat.text}`}>
            <mark>{caveat.text}</mark> <span className="ref">{caveat.n}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function notesLink(item: ContextItem): string {
  return `/notes?doc=${encodeURIComponent(item.docId)}&section=${encodeURIComponent(item.sectionId)}`;
}

function OriginalSection({ item }: { item: ContextItem }) {
  const { documentDetail } = useStudy();
  const [section, setSection] = useState<Section | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    documentDetail(item.docId)
      .then((detail) => {
        if (!alive) return;
        const found = detail.sections.find((s) => s.id === item.sectionId);
        if (found) setSection(found);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [documentDetail, item.docId, item.sectionId]);

  if (failed)
    return <p className="fine">The original section could not be loaded.</p>;
  if (!section)
    return (
      <p className="fine">
        <Loader2 size={13} className="spin" aria-hidden /> Opening your notes…
      </p>
    );
  return (
    <div className="original">
      <p className="original-text">
        {markFragment(section.text, item.text).map((run, index) =>
          run.marked ? (
            <mark key={index}>{run.text}</mark>
          ) : (
            <span key={index}>{run.text}</span>
          ),
        )}
      </p>
      <p className="fine">
        {section.title} · {section.location} · {plural(section.words, "word")}
        {item.text.trim().length < section.text.trim().length &&
          " · the highlighted part is what the model was given"}{" "}
        ·{" "}
        <Link href={notesLink(item)} className="link">
          Open in Notes
        </Link>
      </p>
    </div>
  );
}

/** One supporting section: what the model read, and the original it came from. */
export function SourceCard({
  item,
  cited,
  defaultOpen = false,
}: {
  item: ContextItem;
  cited?: boolean;
  defaultOpen?: boolean;
}) {
  const [original, setOriginal] = useState(false);
  return (
    <details
      className="source"
      open={defaultOpen}
      data-cited={cited || undefined}
    >
      <summary>
        <span className="ref">{item.n}</span>
        <span className="source-title">
          <strong>{item.title}</strong>
          <small>
            {item.docName} · {item.location} · {plural(item.words, "word")}
          </small>
        </span>
        {!item.expanded && item.words < item.sectionWords && (
          <span
            className="tag"
            title={`A fragment of a section of ${plural(item.sectionWords, "word")}`}
          >
            fragment
          </span>
        )}
        {item.expanded && (
          <span
            className="tag tag-mark"
            title={`${plural(item.matchedChunkIds.length, "small match", "small matches")} grew to the whole section`}
          >
            expanded to section
          </span>
        )}
        {cited && <span className="tag tag-accent">cited</span>}
        <ChevronDown size={15} className="chevron" aria-hidden />
      </summary>
      <div className="source-body">
        <p className="source-text">{item.text}</p>
        {item.words >= item.sectionWords ? (
          // The model was given the whole section, so there is nothing more
          // to unfold: the original is one click away.
          <Link href={notesLink(item)} className="link">
            <BookOpenText size={13} aria-hidden /> Open in the original notes
          </Link>
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => setOriginal((open) => !open)}
            aria-expanded={original}
          >
            <BookOpenText size={13} aria-hidden />{" "}
            {original
              ? "Hide the original section"
              : `Show the whole section (${plural(item.sectionWords, "word")})`}
          </button>
        )}
        {original && <OriginalSection item={item} />}
      </div>
    </details>
  );
}

export function SampleButton({ quiet = false }: { quiet?: boolean }) {
  const { sample, sampleState, addSample, health } = useStudy();
  if (!sample || sample.loaded) return null;
  return (
    <button
      type="button"
      className={quiet ? "button button-outline" : "button"}
      disabled={!health || sampleState === "loading"}
      onClick={() => void addSample()}
    >
      {sampleState === "loading" ? (
        <Loader2 size={15} className="spin" aria-hidden />
      ) : (
        <Sparkles size={15} aria-hidden />
      )}
      {sampleState === "failed"
        ? "Try the sample notes again"
        : "Try the sample notes"}
    </button>
  );
}

const STAGES: { stage: UploadStage; label: string }[] = [
  { stage: "reading", label: "Read the file" },
  { stage: "text", label: "Extract the text" },
  { stage: "ocr", label: "Read scans and images (OCR)" },
  { stage: "sectioning", label: "Find the sections" },
  { stage: "embedding", label: "Chunk both ways and index by meaning" },
  { stage: "indexing", label: "Index by keywords" },
];

export function UploadPanel({ compact = false }: { compact?: boolean }) {
  const { upload, uploadOutcomes, uploadFiles, health, documents } = useStudy();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const limit = health?.limits.documents ?? 0;
  const room = Math.max(0, limit - (documents?.length ?? 0));
  const disabled = !health || !!upload || room === 0;
  const current = upload
    ? STAGES.findIndex((s) => s.stage === upload.stage)
    : -1;

  const choose = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []).slice(0, room);
    if (files.length && !disabled) void uploadFiles(files);
  };
  const failed = uploadOutcomes.filter((o) => !o.ok);
  const added = uploadOutcomes.filter((o) => o.ok).length;

  return (
    <div className="upload" data-compact={compact || undefined}>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        multiple
        hidden
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = "";
        }}
      />
      {upload ? (
        <div className="upload-progress" role="status">
          <p className="upload-file">
            <FileText size={15} aria-hidden />
            <span>{upload.fileName}</span>
            {upload.count > 1 && (
              <small>
                file {upload.index} of {upload.count}
              </small>
            )}
          </p>
          <ol className="steps">
            {STAGES.map(({ stage, label }, index) => {
              const state =
                index < current
                  ? "done"
                  : index === current
                    ? "current"
                    : "todo";
              const skipped =
                stage === "ocr" && state === "done" && !upload.sawOcr;
              return (
                <li key={stage} data-state={state}>
                  <span className="step-dot" aria-hidden>
                    {state === "done" ? (
                      <Check size={11} strokeWidth={3} />
                    ) : state === "current" ? (
                      <Loader2 size={11} className="spin" />
                    ) : null}
                  </span>
                  <span>
                    {label}
                    {skipped && <small> — not needed</small>}
                    {state === "current" && upload.total ? (
                      <small>
                        {" "}
                        — {upload.done} of {upload.total}
                      </small>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {upload.total ? (
            <progress value={upload.done ?? 0} max={upload.total} aria-hidden />
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="dropzone"
          data-dragging={dragging || undefined}
          disabled={disabled}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files);
          }}
        >
          <span className="dropzone-icon" aria-hidden>
            <Upload size={20} />
          </span>
          <strong>
            {room === 0 && limit
              ? "Your notebook is full"
              : "Add your notes — one file or several"}
          </strong>
          <small>
            {room === 0 && limit
              ? `Remove a set of notes to add another (limit ${limit}).`
              : "Drop files here or click to choose · PDF, Word (.docx), TXT or MD · up to 40 MB each"}
          </small>
          {!compact && room > 0 && (
            <small className="dropzone-note">
              <ScanText size={13} aria-hidden /> Scanned pages and text inside
              images are read with OCR (printed text works best)
            </small>
          )}
        </button>
      )}
      {!upload && uploadOutcomes.length > 0 && (
        <div className="upload-outcomes" role="status">
          {added > 0 && (
            <p className="ok">
              <Check size={14} aria-hidden /> {plural(added, "file")} added to
              your notes.
            </p>
          )}
          {failed.map((o) => (
            <p key={o.fileName} className="error">
              <AlertCircle size={14} aria-hidden /> {o.fileName}: {o.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Offered beside results whose chunking the lab can take apart. */
export function LabLink({ question }: { question: string }) {
  const { runLab } = useStudy();
  return (
    <Link
      href="/compare"
      className="link"
      onClick={() => void runLab(question)}
    >
      <FlaskConical size={13} aria-hidden /> Compare chunkings for this question
    </Link>
  );
}
