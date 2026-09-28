"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  MessageCircle,
  ScanText,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import type { Passage, TurnStatus, UploadStage } from "@/lib/types";
import { useRag } from "./rag-provider";
export { titleCase } from "@/lib/text";

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : many}`;
}

export const STATUS_TEXT: Record<TurnStatus, string> = {
  answered: "Answered from your documents, with sources.",
  not_found: "This isn't covered by the documents in the library.",
  uncited:
    "This reply doesn't cite a passage, so treat any facts in it with care.",
  no_passages: "No passages matched this question.",
  interrupted: "The answer stopped partway through.",
  unavailable:
    "The assistant couldn't be reached, so here are the passages that were found.",
  sources_only:
    "No model key is configured, so here are the passages that were found.",
};

const LAYERS = [
  { href: "/how-it-works", label: "Overview" },
  { href: "/retrieval", label: "1 · Retrieval" },
  { href: "/augmentation", label: "2 · Augmentation" },
  { href: "/generation", label: "3 · Generation" },
];

export function LayerNav() {
  const pathname = usePathname();
  return (
    <nav className="layer-nav" aria-label="How it works">
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
    <header className="layer-intro">
      <LayerNav />
      <span className="eyebrow">Step {step}</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
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
  const { turns, inspected, inspect } = useRag();
  if (turns.length < 2 || !inspected) return null;
  return (
    <label className="turn-picker">
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
      <MessageCircle size={26} aria-hidden />
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

export function PassageCard({
  passage,
  label,
  cited,
  defaultOpen = false,
}: {
  passage: Passage;
  label?: ReactNode;
  cited?: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="passage"
      open={defaultOpen}
      data-cited={cited || undefined}
    >
      <summary>
        {label != null && <span className="passage-n">{label}</span>}
        <span className="passage-title">
          <strong>{passage.title}</strong>
          <small>
            {passage.docName} · {passage.location}
            {passage.ocr && <span className="tag">OCR</span>}
          </small>
        </span>
        {cited && <span className="tag tag-accent">cited</span>}
        <ChevronDown size={15} className="chevron" aria-hidden />
      </summary>
      <p className="passage-text">{passage.text}</p>
    </details>
  );
}

const STAGES: { stage: UploadStage; label: string }[] = [
  { stage: "reading", label: "Read the file" },
  { stage: "text", label: "Extract the text" },
  { stage: "ocr", label: "Read scans and images (OCR)" },
  { stage: "chunking", label: "Split into passages" },
  { stage: "embedding", label: "Index by meaning" },
  { stage: "indexing", label: "Index by keywords" },
];

export function UploadPanel({ compact = false }: { compact?: boolean }) {
  const { upload, uploadOutcomes, uploadFiles, health, documents } = useRag();
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
              ? "Library is full"
              : "Add documents — one or several at once"}
          </strong>
          <small>
            {room === 0 && limit
              ? `Remove a document to add another (limit ${limit}).`
              : "Drop files here or click to choose · PDF, Word (.docx), TXT or MD · up to 40 MB each"}
          </small>
          {!compact && room > 0 && (
            <small className="dropzone-note">
              <ScanText size={13} aria-hidden /> Scanned pages and text inside
              images are read with OCR
            </small>
          )}
        </button>
      )}
      {!upload && uploadOutcomes.length > 0 && (
        <div className="upload-outcomes" role="status">
          {added > 0 && (
            <p className="ok">
              <Check size={14} aria-hidden /> {plural(added, "document")} added
              to the library.
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
