"use client";

import {
  BookOpenText,
  FileText,
  Loader2,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  fixedWindows,
  formatBytes,
  formatMs,
  plural,
  readingMinutes,
} from "@/lib/text";
import type { Chunking, DocumentDetail, Section } from "@/lib/types";
import { useStudy } from "./study-provider";
import { SampleButton, Stat, UploadPanel } from "./ui";

const FORMAT = {
  pdf: "PDF",
  word: "Word",
  text: "Text",
  sample: "Sample notes",
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
            title={`Page ${p.page}: ${p.chars.toLocaleString("en")} characters · ${METHOD_LABEL[p.method]}`}
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

/** Section lengths in words, one bar each, in reading order. */
function SectionSizes({ detail }: { detail: DocumentDetail }) {
  const most = Math.max(...detail.sections.map((s) => s.words), 1);
  const sections = detail.sections.slice(0, 120);
  return (
    <div className="page-map" role="img" aria-label="Words in each section">
      {sections.map((s) => (
        <span
          key={s.id}
          data-method="text"
          style={{ height: `${Math.max(6, (s.words / most) * 100)}%` }}
          title={`${s.title}: ${plural(s.words, "word")}`}
        />
      ))}
    </div>
  );
}

function SectionText({
  section,
  view,
  fixed,
}: {
  section: Section;
  view: Chunking;
  fixed: DocumentDetail["chunking"]["fixed"];
}) {
  if (view === "section") return <p className="reader-text">{section.text}</p>;
  const windows = fixedWindows(
    section.text,
    fixed.chunkWords,
    fixed.minTailWords,
  );
  return (
    <p className="reader-text reader-windows">
      {windows.map((window) => (
        <span
          key={window.piece}
          className="window"
          data-band={window.piece % 2 ? "a" : "b"}
          title={`Window ${window.piece} of ${windows.length} · ${plural(window.words, "word")}`}
        >
          <sup>{window.piece}</sup>
          {window.text}
        </span>
      ))}
    </p>
  );
}

function Detail({
  detail,
  focus,
}: {
  detail: DocumentDetail;
  focus: string | null;
}) {
  const {
    overviewPending,
    requestOverview,
    health,
    ask,
    streaming,
    removeDocument,
  } = useStudy();
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<Chunking>("section");
  const reader = useRef<HTMLDivElement>(null);
  const { extraction, sectioning, chunking, index, embeddings, timings } =
    detail;
  const overview = detail.overview;
  const needle = filter.trim().toLowerCase();
  const sections = detail.sections.filter(
    (s) =>
      !needle ||
      `${s.title} ${s.text} ${s.location}`.toLowerCase().includes(needle),
  );

  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() =>
      reader.current
        ?.querySelector(`[data-section="${CSS.escape(focus)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focus, detail.id]);

  return (
    <div className="notes-detail">
      <header className="doc-header">
        <div>
          <h2>{detail.name}</h2>
          <p className="muted">
            {FORMAT[detail.format]}
            {detail.bytes ? ` · ${formatBytes(detail.bytes)}` : ""}
            {extraction.pageCount
              ? ` · ${plural(extraction.pageCount, "page")}`
              : ""}{" "}
            · {plural(detail.sections.length, "section")} ·{" "}
            {detail.words.toLocaleString("en")} words · about{" "}
            {readingMinutes(detail.words)} min to read
          </p>
        </div>
        <button
          type="button"
          className="button button-outline"
          onClick={() => {
            if (window.confirm(`Remove “${detail.name}” from your notes?`))
              void removeDocument(detail.id);
          }}
        >
          <Trash2 size={14} aria-hidden /> Remove
        </button>
      </header>

      <section className="card overview">
        <h3 className="card-title">
          <Sparkles size={15} aria-hidden /> In short
        </h3>
        {overview ? (
          <>
            <p>{overview.summary}</p>
            {overview.keyTerms.length > 0 && (
              <div className="chips">
                {overview.keyTerms.map((term) => (
                  <span key={term} className="chip">
                    {term}
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
                    disabled={streaming}
                    onClick={() => {
                      void ask(q, false);
                      router.push("/ask");
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <p className="fine">
              Written by {overview.model} from a sample of these notes.
            </p>
          </>
        ) : overviewPending[detail.id] ? (
          <p className="muted">
            <Loader2 size={14} className="spin" aria-hidden /> Reading a sample
            of these notes to describe them…
          </p>
        ) : health?.generation ? (
          <button
            type="button"
            className="button"
            onClick={() => void requestOverview(detail.id)}
          >
            Describe these notes
          </button>
        ) : (
          <p className="muted">An overview needs a model key on the server.</p>
        )}
      </section>

      <h3 className="section-title">What happened to this file</h3>
      <div className="pipeline-grid">
        <section className="card">
          <p className="card-step">1 · Read</p>
          {detail.format === "sample" ? (
            <p className="muted">
              The sample notes come already divided into sections, so nothing
              had to be extracted.
            </p>
          ) : (
            <>
              <div className="stats">
                <Stat label="Pages" value={extraction.pageCount || "—"} />
                <Stat label="Text layer" value={extraction.textPages} />
                <Stat label="OCR pages" value={extraction.ocrPages} />
                <Stat label="Images read" value={extraction.imageRegions} />
              </div>
              <PageMap detail={detail} />
              <p className="fine">
                {extraction.characters.toLocaleString("en")} characters in{" "}
                {extraction.blocks} text blocks
                {extraction.ocrEngine
                  ? ` · OCR by ${extraction.ocrEngine}`
                  : ""}
                {extraction.ocrFailed ? " · some images could not be read" : ""}
              </p>
            </>
          )}
        </section>
        <section className="card">
          <p className="card-step">2 · Find the sections</p>
          <div className="stats">
            <Stat label="Sections" value={detail.sections.length} />
            <Stat label="Headings" value={sectioning.headings} />
            <Stat
              label="Split for length"
              value={sectioning.splitHeadings}
              hint="Headings with more under them than one section may hold"
            />
          </div>
          <SectionSizes detail={detail} />
          <p className="fine">
            {sectioning.maxWords
              ? `A section is a heading and the text under it, up to ${sectioning.maxWords} words. Longer ones are split between paragraphs.`
              : "Each section is as the notes define it."}
            {detail.truncated
              ? " This file was trimmed to the size limit."
              : ""}
          </p>
        </section>
        <section className="card">
          <p className="card-step">3 · Chunk, both ways</p>
          <table className="mini-table">
            <thead>
              <tr>
                <th />
                <th scope="col">Section-aware</th>
                <th scope="col">Fixed-length</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Chunks</th>
                <td>{chunking.section.count}</td>
                <td>{chunking.fixed.count}</td>
              </tr>
              <tr>
                <th scope="row">Average words</th>
                <td>{chunking.section.averageWords}</td>
                <td>{chunking.fixed.averageWords}</td>
              </tr>
              <tr>
                <th scope="row">Smallest</th>
                <td>{chunking.section.minWords}</td>
                <td>{chunking.fixed.minWords}</td>
              </tr>
              <tr>
                <th scope="row">Largest</th>
                <td>{chunking.section.maxWords}</td>
                <td>{chunking.fixed.maxWords}</td>
              </tr>
            </tbody>
          </table>
          <p className="fine">
            Fixed-length windows hold {chunking.fixed.chunkWords} words and
            never cross a heading. A section&rsquo;s last window joins the one
            before it when it would hold fewer than{" "}
            {chunking.fixed.minTailWords} words. Both sets are indexed, so a
            question can be asked of either.
          </p>
        </section>
        <section className="card">
          <p className="card-step">4 · Index</p>
          <div className="stats">
            <Stat label="Words" value={index.words.toLocaleString("en")} />
            <Stat
              label="Distinct terms"
              value={index.vocabulary.toLocaleString("en")}
            />
            {embeddings && (
              <Stat label="Numbers per vector" value={embeddings.dimensions} />
            )}
          </div>
          <div className="chips">
            {index.topTerms.slice(0, 10).map((t) => (
              <span key={t.term} className="chip" title={`${t.count} times`}>
                {t.term} <small>{t.count}</small>
              </span>
            ))}
          </div>
          <p className="fine">
            By keywords: {index.engine}.{" "}
            {embeddings
              ? `By meaning: ${embeddings.model} turned every chunk into ${embeddings.dimensions} numbers.`
              : "Semantic search is off, so no vectors were made."}
          </p>
        </section>
      </div>
      {Object.keys(timings).length > 0 && (
        <p className="timings">
          {timings.extractMs != null &&
            `Read ${formatMs(timings.extractMs)} · `}
          {timings.sectionMs != null &&
            `Sections ${formatMs(timings.sectionMs)} · `}
          {timings.embedMs != null && `Embed ${formatMs(timings.embedMs)}`}
          {timings.indexMs != null && ` · Index ${formatMs(timings.indexMs)}`}
        </p>
      )}

      <div className="reader-head">
        <h3 className="section-title">The notes</h3>
        <div className="segmented" role="group" aria-label="Show the notes as">
          <button
            type="button"
            aria-pressed={view === "section"}
            onClick={() => setView("section")}
          >
            As sections
          </button>
          <button
            type="button"
            aria-pressed={view === "fixed"}
            onClick={() => setView("fixed")}
          >
            As {chunking.fixed.chunkWords}-word windows
          </button>
        </div>
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Search ${plural(detail.sections.length, "section")}…`}
            aria-label="Search sections"
          />
        </label>
      </div>
      {view === "fixed" && (
        <p className="fine">
          Each shaded band is one fixed-length chunk. Notice where a band begins
          or ends in the middle of a sentence: that is all a search can return
          for it, unless the match is expanded to its section.
        </p>
      )}
      <div className="reader" ref={reader}>
        {sections.map((section) => (
          <article
            key={section.id}
            className="reader-section"
            data-section={section.id}
            data-focus={focus === section.id || undefined}
          >
            <h4>{section.title}</h4>
            <SectionText section={section} view={view} fixed={chunking.fixed} />
            <p className="fine">
              {section.location} · {plural(section.words, "word")}
              {section.ocr ? " · read with OCR" : ""}
            </p>
          </article>
        ))}
        {!sections.length && (
          <p className="muted">No section contains “{filter}”.</p>
        )}
      </div>
    </div>
  );
}

export function NotesView() {
  const { documents, documentsError, documentDetail, settings } = useStudy();
  const params = useSearchParams();
  const router = useRouter();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = params.get("doc");
  const current =
    documents?.find((d) => d.id === wanted)?.id ??
    documents?.at(-1)?.id ??
    null;
  const summary = documents?.find((d) => d.id === current);
  const chunkWords = settings?.settings.chunkWords;

  useEffect(() => {
    if (!current) return;
    let alive = true;
    documentDetail(current)
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
  }, [current, summary?.addedAt, chunkWords, documentDetail]);

  const shown =
    detail && detail.id === current && summary
      ? { ...detail, overview: summary.overview }
      : null;

  return (
    <div className="notes">
      <aside className="notes-rail">
        <span className="eyebrow">Notes</span>
        <h1>Your notebook</h1>
        <p className="muted">
          Everything the companion explains from. Files are read on the server
          and indexed. Nothing trains the model.
        </p>
        <UploadPanel />
        <SampleButton quiet />
        {documentsError && <p className="error">{documentsError}</p>}
        <ul className="doc-list">
          {documents?.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === current || undefined}
                onClick={() =>
                  router.replace(`/notes?doc=${encodeURIComponent(d.id)}`, {
                    scroll: false,
                  })
                }
              >
                <FileText size={16} aria-hidden />
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {d.pages ? `${plural(d.pages, "page")} · ` : ""}
                    {plural(d.sections, "section")}
                    {d.ocrPages + d.imageRegions > 0 ? " · OCR" : ""}
                    {d.sample ? " · sample" : ""}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="notes-main">
        {!documents?.length ? (
          <div className="empty">
            <BookOpenText size={26} aria-hidden />
            <h2>No notes yet</h2>
            <p>
              Add lecture notes, a chapter or a summary sheet. Clear headings
              help: each heading becomes a section you can be pointed back to.
            </p>
          </div>
        ) : error ? (
          <p className="error">{error}</p>
        ) : shown ? (
          <Detail detail={shown} focus={params.get("section")} />
        ) : (
          <p className="muted">
            <Loader2 size={14} className="spin" aria-hidden /> Loading…
          </p>
        )}
      </div>
    </div>
  );
}
