"use client";

import { FileText, Loader2, Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getDocument } from "@/lib/api";
import type { DocumentDetail } from "@/lib/types";
import { useRag } from "./rag-provider";
import {
  formatBytes,
  formatMs,
  PassageCard,
  plural,
  Stat,
  UploadPanel,
} from "./ui";

const FORMAT = {
  pdf: "PDF",
  word: "Word",
  text: "Text",
  sections: "Sections",
} as const;
const METHOD_LABEL = {
  text: "Text layer",
  ocr: "OCR (scanned page)",
  "text+ocr": "Text layer + OCR of images",
  empty: "No readable text",
} as const;

function PageMap({ detail }: { detail: DocumentDetail }) {
  const pages = detail.extraction.pages;
  if (!pages.length) return null;
  const most = Math.max(...pages.map((p) => p.chars), 1);
  return (
    <div>
      <div
        className="page-map"
        role="img"
        aria-label="Characters extracted per page"
      >
        {pages.map((p) => (
          <span
            key={p.page}
            data-method={p.method}
            style={{ height: `${Math.max(6, (p.chars / most) * 100)}%` }}
            title={`Page ${p.page}: ${p.chars.toLocaleString()} characters · ${METHOD_LABEL[p.method]}`}
          />
        ))}
      </div>
      <p className="legend">
        <span data-method="text" /> text layer <span data-method="text+ocr" />{" "}
        text + OCR of images <span data-method="ocr" /> OCR only{" "}
        <span data-method="empty" /> empty
      </p>
    </div>
  );
}

function SizeHistogram({ detail }: { detail: DocumentDetail }) {
  const sizes = detail.chunks.map((c) => c.chars);
  const top = Math.max(...sizes, 1);
  const bins = Array.from({ length: 12 }, () => 0);
  for (const size of sizes)
    bins[Math.min(11, Math.floor((size / top) * 12))] += 1;
  const most = Math.max(...bins, 1);
  return (
    <div
      className="histogram"
      role="img"
      aria-label="Distribution of chunk sizes"
    >
      {bins.map((count, i) => (
        <span
          key={i}
          style={{ height: `${(count / most) * 100}%` }}
          title={`${count} chunks`}
        />
      ))}
    </div>
  );
}

function Elaboration({ detail }: { detail: DocumentDetail }) {
  const { overviewPending, requestOverview, health, setDraft, removeDocument } =
    useRag();
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { extraction, chunking, index, embeddings, timings } = detail;
  const overview = detail.overview;
  const needle = filter.trim().toLowerCase();
  const chunks = detail.chunks.filter(
    (c) =>
      !needle ||
      `${c.title} ${c.text} ${c.location}`.toLowerCase().includes(needle),
  );
  const visible = showAll || needle ? chunks : chunks.slice(0, 12);

  return (
    <div className="elaboration">
      <header className="doc-header">
        <div>
          <h2>{detail.name}</h2>
          <p className="muted">
            {FORMAT[detail.format]}
            {detail.bytes ? ` · ${formatBytes(detail.bytes)}` : ""}
            {extraction.pageCount
              ? ` · ${plural(extraction.pageCount, "page")}`
              : ""}{" "}
            · added {new Date(detail.addedAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            if (window.confirm(`Remove “${detail.name}” from this workspace?`))
              void removeDocument(detail.id);
          }}
        >
          <Trash2 size={14} aria-hidden /> Remove
        </button>
      </header>

      <section className="card overview">
        <h3>
          <Sparkles size={15} aria-hidden /> In short
        </h3>
        {overview ? (
          <>
            <p>{overview.summary}</p>
            {overview.topics.length > 0 && (
              <div className="chips">
                {overview.topics.map((topic) => (
                  <span key={topic} className="chip">
                    {topic}
                  </span>
                ))}
              </div>
            )}
            {overview.questions.length > 0 && (
              <div className="suggestions">
                {overview.questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setDraft(q);
                      router.push("/ask");
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <p className="fine">
              Written by {overview.model} from a sample of the document.
            </p>
          </>
        ) : overviewPending[detail.id] ? (
          <p className="muted">
            <Loader2 size={14} className="spin" aria-hidden /> Reading a sample
            of the document to describe it…
          </p>
        ) : health?.generation ? (
          <button
            type="button"
            className="button"
            onClick={() => void requestOverview(detail.id)}
          >
            Describe this document
          </button>
        ) : (
          <p className="muted">An overview needs a model key on the server.</p>
        )}
      </section>

      <h3 className="section-title">What the pipeline did with this file</h3>
      <div className="pipeline-grid">
        <section className="card">
          <p className="card-step">1 · Extract</p>
          <div className="stats">
            <Stat label="Pages" value={extraction.pageCount || "—"} />
            <Stat label="Text layer" value={extraction.textPages} />
            <Stat label="OCR pages" value={extraction.ocrPages} />
            <Stat label="Images read" value={extraction.imageRegions} />
          </div>
          <PageMap detail={detail} />
          <p className="fine">
            {extraction.characters.toLocaleString()} characters in{" "}
            {extraction.blocks} text blocks
            {extraction.ocrEngine ? ` · OCR by ${extraction.ocrEngine}` : ""}
            {extraction.ocrFailed ? " · some images could not be read" : ""}
          </p>
        </section>
        <section className="card">
          <p className="card-step">2 · Chunk</p>
          <div className="stats">
            <Stat label="Chunks" value={chunking.count} />
            <Stat label="Average" value={`${chunking.averageChars} ch`} />
            <Stat label="Smallest" value={`${chunking.minChars} ch`} />
            <Stat label="Largest" value={`${chunking.maxChars} ch`} />
          </div>
          <SizeHistogram detail={detail} />
          <p className="fine">
            {chunking.target
              ? `Aiming for ~${chunking.target} characters, never over ${chunking.maximum}; new chunk at each heading; overlap: ${chunking.overlap}.`
              : `Overlap: ${chunking.overlap}.`}
            {detail.truncated
              ? " This file was trimmed to the size limit."
              : ""}
          </p>
        </section>
        <section className="card">
          <p className="card-step">3 · Embed</p>
          {embeddings ? (
            <>
              <div className="stats">
                <Stat label="Vectors" value={chunking.count} />
                <Stat label="Numbers each" value={embeddings.dimensions} />
              </div>
              {embeddings.sample && (
                <p
                  className="vector"
                  title="The first numbers of chunk 1's vector"
                >
                  [{embeddings.sample.map((x) => x.toFixed(3)).join(", ")}, …{" "}
                  {embeddings.dimensions - embeddings.sample.length} more]
                </p>
              )}
              <p className="fine">
                {embeddings.model} turned every chunk into a list of{" "}
                {embeddings.dimensions} numbers that encodes its meaning, so
                questions can match by meaning, not just words.
              </p>
            </>
          ) : (
            <p className="muted">
              Semantic search is off, so no vectors were made.
            </p>
          )}
        </section>
        <section className="card">
          <p className="card-step">4 · Index</p>
          <div className="stats">
            <Stat label="Words" value={index.words.toLocaleString()} />
            <Stat
              label="Distinct terms"
              value={index.vocabulary.toLocaleString()}
            />
          </div>
          <div className="chips">
            {index.topTerms.map((t) => (
              <span key={t.term} className="chip" title={`${t.count} times`}>
                {t.term} <small>{t.count}</small>
              </span>
            ))}
          </div>
          <p className="fine">{index.engine}.</p>
        </section>
      </div>
      {Object.keys(timings).length > 0 && (
        <p className="timings">
          Extract {formatMs(timings.extractMs)} · Chunk{" "}
          {formatMs(timings.chunkMs)}
          {timings.embedMs != null && ` · Embed ${formatMs(timings.embedMs)}`} ·
          Index {formatMs(timings.indexMs)}
        </p>
      )}

      <h3 className="section-title">Chunks</h3>
      <label className="search">
        <Search size={15} aria-hidden />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Search ${plural(detail.chunks.length, "chunk")}…`}
          aria-label="Search chunks"
        />
      </label>
      <div className="passages">
        {visible.map((c) => (
          <PassageCard
            key={c.id}
            passage={{ ...c, docId: detail.id, docName: detail.name }}
            label={c.id.replace(/^c0*/, "")}
          />
        ))}
        {!chunks.length && (
          <p className="muted">No chunk contains “{filter}”.</p>
        )}
      </div>
      {!showAll && !needle && chunks.length > visible.length && (
        <button
          type="button"
          className="button button-quiet"
          onClick={() => setShowAll(true)}
        >
          Show all {chunks.length} chunks
        </button>
      )}
    </div>
  );
}

export function LibraryView() {
  const { documents, documentsError } = useRag();
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current =
    documents?.find((d) => d.id === chosen)?.id ??
    documents?.at(-1)?.id ??
    null;
  const summary = documents?.find((d) => d.id === current);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    getDocument(current)
      .then((result) => {
        if (alive) {
          setDetail(result);
          setError(null);
        }
      })
      .catch((cause: Error) => alive && setError(cause.message));
    return () => {
      alive = false;
    };
  }, [current, summary?.addedAt]);

  const shown =
    detail && detail.id === current && summary
      ? { ...detail, overview: summary.overview }
      : null;

  return (
    <div className="documents">
      <aside className="doc-rail">
        <h1>Library</h1>
        <p className="muted">
          Everything the assistant can answer from. Add one file or many at
          once; each is read on the server and indexed. Nothing trains the
          model.
        </p>
        <UploadPanel />
        {documentsError && <p className="error">{documentsError}</p>}
        <ul className="doc-list">
          {documents?.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === current || undefined}
                onClick={() => setChosen(d.id)}
              >
                <FileText size={16} aria-hidden />
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {d.pages ? `${plural(d.pages, "page")} · ` : ""}
                    {plural(d.chunks, "chunk")}
                    {d.ocrPages + d.imageRegions > 0 ? " · OCR" : ""}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="doc-main">
        {!documents?.length ? (
          <div className="empty">
            <FileText size={26} aria-hidden />
            <h2>The library is empty</h2>
            <p>
              Add your school&rsquo;s handbooks, guides and notices to start
              answering questions from them.
            </p>
          </div>
        ) : error ? (
          <p className="error">{error}</p>
        ) : shown ? (
          <Elaboration detail={shown} />
        ) : (
          <p className="muted">
            <Loader2 size={14} className="spin" aria-hidden /> Loading…
          </p>
        )}
      </div>
    </div>
  );
}
