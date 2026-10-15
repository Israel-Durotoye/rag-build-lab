"use client";

import {
  Binary,
  CircleCheck,
  CircleX,
  FileText,
  Library,
  ScanText,
  Upload,
} from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { formatBytes, plural } from "@/lib/text";
import type { Health, UploadProgress } from "@/lib/types";
import { useFinder, type UploadOutcome } from "./finder-provider";
import styles from "./library-view.module.css";

/** What the file picker offers: the formats the backend reads. */
const ACCEPT = ".pdf,.docx,.txt,.md";
const EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

type StepId =
  "reading" | "ocr" | "sectioning" | "tagging" | "embedding" | "indexing";

/** An upload's steps in order, with the backend stages each one covers
 * ("text" is the file's text layer being read, page by page). */
const STEPS: { id: StepId; label: string; stages: string[] }[] = [
  { id: "reading", label: "Reading", stages: ["reading", "text"] },
  { id: "ocr", label: "Reading scanned pages", stages: ["ocr"] },
  { id: "sectioning", label: "Finding sections", stages: ["sectioning"] },
  { id: "tagging", label: "Tagging models", stages: ["tagging"] },
  { id: "embedding", label: "Embedding", stages: ["embedding"] },
  { id: "indexing", label: "Indexing", stages: ["indexing"] },
];

/** "40 MB" rather than "40.0 MB" when the limit is a whole number. */
function sizeLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : formatBytes(bytes);
}

/** Why a file can't be sent, checked before it is uploaded at all. The
 * wording follows the backend's own messages for the same problems. */
function problem(file: File, maxBytes: number | null): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot) : "";
  if (extension === ".doc")
    return "Legacy .doc files aren't supported. Save it as .docx or PDF first.";
  if (!EXTENSIONS.includes(extension))
    return "Add a PDF (.pdf), Word (.docx) or text (.txt, .md) file.";
  if (maxBytes !== null && file.size > maxBytes)
    return `This file is over ${sizeLimit(maxBytes)}. Export a smaller version and try again.`;
  return null;
}

/** How far the current stage has got, in words: "page 3 of 40". */
function amount(progress: UploadProgress): string | null {
  const { done, total } = progress;
  if (done == null || !total) return null;
  if (progress.stage === "text")
    return total > 1 ? `page ${done} of ${total}` : null;
  if (progress.stage === "embedding")
    return `${done} of ${plural(total, "passage")}`;
  if (progress.stage === "ocr") return `${done} of ${plural(total, "page")}`;
  return `${done} of ${total}`;
}

function semanticOn(health: Health | null): boolean {
  const status = health?.embeddings.status;
  return status === "ready" || status === "loading";
}

function UploadSteps({
  upload,
  sawOcr,
  health,
}: {
  upload: UploadProgress;
  sawOcr: boolean;
  health: Health | null;
}) {
  const current = STEPS.findIndex((step) => step.stages.includes(upload.stage));
  const step = STEPS[current];
  const count = amount(upload);
  const ofFiles =
    upload.count && upload.count > 1
      ? `file ${(upload.index ?? 0) + 1} of ${upload.count}`
      : null;
  const fraction =
    upload.total && upload.done != null
      ? Math.min(1, upload.done / upload.total)
      : null;
  const ocrOn = health?.ocr.enabled ?? true;
  const embedding = semanticOn(health);

  return (
    <div className={styles.progress}>
      <p className={styles.progressFile}>
        <FileText size={17} aria-hidden />
        <span className={styles.fileName}>{upload.fileName}</span>
        {ofFiles && <span className="chip tiny flat">{ofFiles}</span>}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {`${step?.label ?? upload.stage}: ${upload.fileName}${count ? `, ${count}` : ""}${ofFiles ? ` (${ofFiles})` : ""}`}
      </p>
      <ol className={styles.steps}>
        {STEPS.map((item, index) => {
          let state: "done" | "current" | "todo" | "skipped" =
            index < current ? "done" : index === current ? "current" : "todo";
          let note: string | null = null;
          if (item.id === "ocr" && !ocrOn) {
            state = "skipped";
            note = "OCR is off";
          } else if (item.id === "ocr" && state === "done" && !sawOcr) {
            state = "skipped";
            note = "not needed";
          } else if (item.id === "embedding" && !embedding) {
            state = "skipped";
            note = "semantic search is off";
          }
          return (
            <li key={item.id} data-state={state}>
              <span className={styles.led} aria-hidden />
              <span>
                {item.label}
                {note && <small> · {note}</small>}
                {state === "current" && count && <small> · {count}</small>}
              </span>
            </li>
          );
        })}
      </ol>
      {fraction !== null && (
        <div
          className={styles.meter}
          role="progressbar"
          aria-label={`${step?.label ?? "Progress"}: ${count ?? ""}`}
          aria-valuemin={0}
          aria-valuemax={upload.total}
          aria-valuenow={upload.done}
        >
          <span style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** What happens to a file once it is added, as this server runs it. */
function UploadFacts({
  health,
  held,
}: {
  health: Health;
  held: number | null;
}) {
  const { limits, ocr, embeddings } = health;
  const semantic =
    embeddings.status === "ready"
      ? `Each passage is also embedded (${embeddings.model}), so semantic search can find it.`
      : embeddings.status === "loading"
        ? `The embedding model (${embeddings.model}) is still loading; an upload waits for it.`
        : embeddings.status === "failed"
          ? "The embedding model couldn't load, so manuals are found by keyword search only."
          : "Semantic search is off on this server, so manuals are found by keyword search only.";
  return (
    <ul className={styles.limits}>
      <li>
        <FileText size={15} aria-hidden />
        <span>Up to {sizeLimit(limits.fileBytes)} a file.</span>
      </li>
      <li>
        <Library size={15} aria-hidden />
        <span>
          {held === null
            ? `This library holds up to ${plural(limits.documents, "manual")}.`
            : `${held} of ${plural(limits.documents, "manual")} in this library.`}
        </span>
      </li>
      <li>
        <ScanText size={15} aria-hidden />
        <span>
          {ocr.enabled
            ? `Scanned pages are read with OCR (${ocr.engine}).`
            : "OCR is off on this server, so pages without a text layer can't be read."}
        </span>
      </li>
      <li>
        <Binary size={15} aria-hidden />
        <span>{semantic}</span>
      </li>
    </ul>
  );
}

function Outcomes({
  outcomes,
  onClear,
}: {
  outcomes: UploadOutcome[];
  onClear: () => void;
}) {
  if (!outcomes.length) return null;
  const added = outcomes.filter((outcome) => outcome.ok).length;
  return (
    <div className={styles.outcomes}>
      <div className={styles.outcomesHead}>
        <p className="small">
          {added > 0
            ? `${plural(added, "manual")} added. Open each new manual below to confirm the models it covers.`
            : "Nothing was added."}
        </p>
        <button type="button" className="btn quiet small" onClick={onClear}>
          Clear
        </button>
      </div>
      <ul className={styles.outcomeList}>
        {outcomes.map((outcome, index) => (
          <li
            key={`${index}-${outcome.fileName}`}
            className={styles.outcome}
            data-ok={outcome.ok || undefined}
          >
            {outcome.ok ? (
              <CircleCheck size={16} aria-hidden />
            ) : (
              <CircleX size={16} aria-hidden />
            )}
            <span>
              <span className="sr-only">
                {outcome.ok ? "Added: " : "Not added: "}
              </span>
              <span className={styles.outcomeName}>{outcome.fileName}</span>
              {outcome.ok
                ? ""
                : `: ${outcome.message ?? "this file couldn't be added."}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Add manuals: a drop zone and a file picker for PDF, Word, .txt and .md
 * files, several at once. While files are read it shows each step the
 * server reports; afterwards, what was added and what was not, and why.
 */
export function UploadPanel() {
  const { health, library, upload, uploadOutcomes, uploadFiles } = useFinder();
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [dragging, setDragging] = useState(false);
  // The files of the latest choice that were never sent (wrong type, too
  // big), and how many were sent.
  const [batch, setBatch] = useState<{
    skipped: UploadOutcome[];
    sent: number;
  } | null>(null);
  // The file that needed OCR, so the step can say "not needed" otherwise.
  const [ocrFile, setOcrFile] = useState<string | null>(null);

  const limit = health?.limits.documents ?? null;
  const held = library ? library.documents.length : null;
  const full = limit !== null && held !== null && held >= limit;
  const disabled = !health || Boolean(upload) || full;

  const fileKey = upload ? `${upload.index ?? 0}:${upload.fileName}` : null;
  if (upload?.stage === "ocr" && ocrFile !== fileKey) setOcrFile(fileKey);

  const add = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || disabled) return;
    const maxBytes = health?.limits.fileBytes ?? null;
    const skipped: UploadOutcome[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const reason = problem(file, maxBytes);
      if (reason)
        skipped.push({ fileName: file.name, ok: false, message: reason });
      else accepted.push(file);
    }
    setBatch({ skipped, sent: accepted.length });
    if (accepted.length) void uploadFiles(accepted);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };

  // Outcomes from the provider belong to the last batch that sent files.
  const outcomes = [
    ...(batch && batch.sent === 0 ? [] : uploadOutcomes),
    ...(batch?.skipped ?? []),
  ];

  return (
    <section className={`panel ${styles.upload}`} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <span className="eyebrow">Upload</span>
        <h2 id={titleId}>Add manuals</h2>
        <p className="muted small">
          Each file is read on the server, split into sections and passages, and
          added to this browser&rsquo;s private library. You then confirm which
          models it covers.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        aria-label="Choose manuals to add"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      {upload ? (
        <UploadSteps
          upload={upload}
          sawOcr={fileKey !== null && ocrFile === fileKey}
          health={health}
        />
      ) : (
        <button
          type="button"
          className={styles.drop}
          data-dragging={dragging || undefined}
          disabled={disabled}
          onClick={() => input.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={onDrop}
        >
          <span className={styles.dropIcon} aria-hidden>
            <Upload size={22} />
          </span>
          <strong className={styles.dropTitle}>
            {!health
              ? "The backend isn’t reachable"
              : full
                ? "This library is full"
                : dragging
                  ? "Drop to add these files"
                  : "Drop files here, or choose them"}
          </strong>
          <span className="small">
            {!health
              ? "Files can be added once it answers."
              : full
                ? `It holds ${plural(limit ?? 0, "manual")}. Remove one to add another.`
                : "PDF, Word (.docx), text (.txt) or Markdown (.md), several at once"}
          </span>
        </button>
      )}
      {health && <UploadFacts health={health} held={held} />}
      <div aria-live="polite">
        {!upload && (
          <Outcomes
            outcomes={outcomes}
            onClear={() => setBatch({ skipped: [], sent: 0 })}
          />
        )}
      </div>
    </section>
  );
}
