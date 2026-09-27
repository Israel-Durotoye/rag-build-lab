"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  GraduationCap,
  LibraryBig,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type {
  Capabilities,
  RetrievalMode,
  SearchResult,
  Source,
} from "@/lib/types";

const suggestions = [
  "When does the library close?",
  "How many books may I borrow?",
  "How do I request housing?",
];

export default function CampusDesk({
  sections,
  corpusVersion,
  capabilities,
}: {
  sections: Source[];
  corpusVersion: string;
  capabilities: Capabilities;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [previousQuestion, setPreviousQuestion] = useState<string>();
  const [mode, setMode] = useState<RetrievalMode>("keyword");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function openHandbook(source?: Source) {
    setSelectedSource(source ?? null);
    setCopied(false);
    dialog.current?.showModal();
  }

  function reset() {
    requestId.current++;
    controller.current?.abort();
    setQuestion("");
    setResult(null);
    setError("");
    setPreviousQuestion(undefined);
    setLoading(false);
    input.current?.focus();
  }

  async function submit(value: string) {
    const query = value.trim();
    if (!query) {
      input.current?.focus();
      return;
    }
    const id = ++requestId.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 55000);
    setQuestion(value);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, mode, previousQuestion }),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "Search couldn’t finish. Please try again.",
        );
      if (id !== requestId.current) return;
      setResult(data as SearchResult);
      if (data.status !== "clarification")
        setPreviousQuestion(data.retrievalQuery);
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(
        abort.signal.aborted
          ? "Search took too long. Please try again."
          : cause instanceof Error
            ? cause.message
            : "Couldn’t reach Campus Desk. Check your connection and try again.",
      );
    } finally {
      clearTimeout(timeout);
      if (id === requestId.current) setLoading(false);
    }
  }

  async function copySource(source: Source) {
    try {
      await navigator.clipboard.writeText(
        `${source.text}\n\n${source.citationLabel}\nSource ID: ${source.id}`,
      );
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(question);
  };
  const hasSources = !!result?.sources.length;
  const noEvidence = result?.status === "insufficient_evidence";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to search
      </a>
      <aside className="sidebar">
        <Link
          className="brand"
          href="/"
          onClick={reset}
          aria-label="Campus Desk home"
        >
          <span className="brand-mark">
            <BookOpen size={23} strokeWidth={1.7} />
          </span>
          <span>
            campus<span className="brand-light">desk</span>
            <small>RAG BUILD LAB</small>
          </span>
        </Link>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <button className="nav-active" onClick={() => input.current?.focus()}>
          <Search size={18} /> Ask the handbook <span className="nav-dot" />
        </button>
        <button className="nav-link" onClick={() => openHandbook()}>
          <LibraryBig size={18} /> Browse handbook <ChevronRight size={15} />
        </button>
        <div className="sidebar-divider" />
        <div className="section-label">
          IN THE HANDBOOK{" "}
          <span>{sections.length.toString().padStart(2, "0")}</span>
        </div>
        <nav aria-label="Handbook sections" className="section-nav">
          {sections.map((section, index) => (
            <button key={section.id} onClick={() => openHandbook(section)}>
              <span>{(index + 1).toString().padStart(2, "0")}</span>
              {section.title}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <GraduationCap size={22} />
          </div>
          <h3>A little clarity for campus life.</h3>
          <p>Find the detail you need. See exactly where it came from.</p>
          <button onClick={() => openHandbook()}>
            Explore the handbook <ArrowRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Fictional campus · Demo 01{" "}
          <span>v1.0</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">The learning lab</span>
            <ChevronRight size={13} />
            <span>Campus Desk</span>
          </div>
          <span className="synthetic-badge">
            <ShieldCheck size={14} /> Synthetic handbook
          </span>
        </header>
        <main id="main" className="main-content">
          <div className="intro-top">
            <span className="eyebrow">
              <span /> YOUR CAMPUS COMPANION
            </span>
            <button className="text-button reset-button" onClick={reset}>
              <RotateCcw size={14} /> New search
            </button>
          </div>
          <h1>
            Your handbook.
            <br />
            <span>A little easier to navigate.</span>
          </h1>
          <p className="intro-description">
            From library hours to finding a place to live.
            <br className="mobile-break" /> Ask a question, and go straight to
            the source.
          </p>

          <section className="search-box" aria-label="Ask the handbook">
            <form onSubmit={handleSubmit}>
              <label className="search-label" htmlFor="question">
                <Search size={18} /> What would you like to know?
              </label>
              <textarea
                id="question"
                ref={input}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={4000}
                rows={2}
                placeholder="e.g. When does the library close?"
                aria-describedby="search-help"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (!loading) void submit(question);
                  }
                }}
              />
              <div className="search-bottom">
                <span id="search-help">
                  <span className="status-dot" />{" "}
                  {capabilities.generation
                    ? "Model answers with cited evidence"
                    : "Source search · No generated answers"}
                </span>
                <button
                  className="primary-button"
                  disabled={loading || !question.trim()}
                  type="submit"
                >
                  {loading ? "Searching…" : "Search handbook"}
                  <ArrowRight size={17} />
                </button>
              </div>
              {capabilities.modes.length > 1 ? (
                <div className="mode-picker">
                  <label htmlFor="retrieval-mode">Retrieval method</label>
                  <select
                    id="retrieval-mode"
                    value={mode}
                    onChange={(event) => {
                      requestId.current++;
                      controller.current?.abort();
                      setLoading(false);
                      setMode(event.target.value as RetrievalMode);
                      setResult(null);
                      setError("");
                    }}
                  >
                    {capabilities.modes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </form>
          </section>
          <div className="suggestions">
            <span>TRY ASKING</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                disabled={loading}
                onClick={() => void submit(suggestion)}
              >
                {suggestion}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>

          <div aria-live="polite" aria-busy={loading}>
            {error ? (
              <div className="error-notice" role="alert">
                <strong>We couldn’t complete that search.</strong>
                <p>{error}</p>
                <button
                  className="text-button"
                  onClick={() => void submit(question)}
                >
                  Try again <ArrowRight size={14} />
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="loading-state">
                <span className="spinner" />
                <div>
                  <strong>Looking through the handbook</strong>
                  <p>Finding passages for your question…</p>
                </div>
              </div>
            ) : null}
            {result ? (
              <section className="results-section" aria-label="Search results">
                <div className="results-heading">
                  <h2>
                    {result.mode === "generated"
                      ? "Your answer & its sources"
                      : "Here’s what we found"}
                  </h2>
                  <span>
                    <Clock3 size={13} /> {result.elapsedMs} ms
                  </span>
                </div>
                <div className="results-grid">
                  <div
                    className={`result-summary ${noEvidence ? "insufficient" : ""}`}
                  >
                    <span className="eyebrow">
                      {result.mode === "generated"
                        ? "CITED ANSWER"
                        : "SEARCH RESULT"}
                    </span>
                    <div className="summary-icon">
                      {noEvidence ? (
                        <Search size={23} />
                      ) : result.mode === "generated" ? (
                        <Sparkles size={23} />
                      ) : (
                        <BookOpen size={23} />
                      )}
                    </div>
                    <h3>
                      {noEvidence
                        ? "Not enough evidence."
                        : result.status === "clarification"
                          ? "A little more context?"
                          : result.status === "generation_unavailable"
                            ? "Your sources are still here."
                            : result.mode === "generated"
                              ? "Grounded in the handbook."
                              : `${result.sources.length} ${result.sources.length === 1 ? "passage" : "passages"} to explore.`}
                    </h3>
                    <p className="submitted-question">“{result.question}”</p>
                    {result.answer ? (
                      <p className="generated-answer">{result.answer}</p>
                    ) : null}
                    <p>{result.notice}</p>
                    {result.citations.length ? (
                      <div className="citation-list">
                        {result.citations.map((id) => {
                          const source = result.sources.find(
                            (item) => item.id === id,
                          );
                          return source ? (
                            <button
                              key={id}
                              onClick={() => openHandbook(source)}
                            >
                              <FileText size={14} />
                              {source.title}
                              <ExternalLink size={12} />
                            </button>
                          ) : null;
                        })}
                      </div>
                    ) : null}
                    {!hasSources ? (
                      <button
                        className="text-button"
                        onClick={() => openHandbook()}
                      >
                        Browse the handbook <ArrowRight size={15} />
                      </button>
                    ) : (
                      <div className="evidence-note">
                        <ShieldCheck size={17} />
                        <span>
                          A matching passage isn’t always a complete answer.
                          Read the original wording.
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="sources-panel">
                    <div className="sources-label">
                      <span>SELECTED PASSAGES</span>
                      <span>
                        {result.sources.length.toString().padStart(2, "0")}
                      </span>
                    </div>
                    {hasSources ? (
                      result.sources.map((source, index) => (
                        <article className="source-card" key={source.id}>
                          <div className="source-card-top">
                            <span className="source-number">
                              {(index + 1).toString().padStart(2, "0")}
                            </span>
                            <span>STUDENT HANDBOOK</span>
                            <span>v{source.version}</span>
                          </div>
                          <h3>{source.title}</h3>
                          <p>{source.text}</p>
                          <div className="source-card-bottom">
                            <span>
                              <FileText size={13} /> § {source.section}
                            </span>
                            <button onClick={() => openHandbook(source)}>
                              View source <ArrowRight size={14} />
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-sources">
                        <FileText size={30} strokeWidth={1.3} />
                        <p>No supporting passage selected.</p>
                        <small>
                          Try library hours, borrowing, registration, housing,
                          or student support.
                        </small>
                      </div>
                    )}
                  </div>
                </div>
                <details className="retrieval-details">
                  <summary>
                    Behind this search <ArrowDown size={13} />
                  </summary>
                  <dl>
                    <div>
                      <dt>Method</dt>
                      <dd>
                        {result.retrievalMode === "keyword"
                          ? "BM25 keyword search"
                          : result.retrievalMode}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{result.status}</dd>
                    </div>
                    <div>
                      <dt>Search query</dt>
                      <dd>{result.retrievalQuery}</dd>
                    </div>
                    <div>
                      <dt>Corpus revision</dt>
                      <dd>{result.corpusVersion}</dd>
                    </div>
                  </dl>
                </details>
              </section>
            ) : !loading && !error ? (
              <section className="start-section">
                <div className="section-heading">
                  <h2>Good questions start here.</h2>
                  <span>One handbook. Original sources.</span>
                </div>
                <div className="topic-grid">
                  {[
                    {
                      icon: <BookOpen />,
                      title: "Study & discover",
                      description:
                        "Library hours, borrowing limits, and getting into the lab.",
                      query: "How many books may I borrow?",
                      label: "Explore studying",
                    },
                    {
                      icon: <GraduationCap />,
                      title: "Make yourself at home",
                      description:
                        "Find your way through housing and student support.",
                      query: "How do I request housing?",
                      label: "Explore campus life",
                    },
                    {
                      icon: <FileText />,
                      title: "Know the next step",
                      description:
                        "Keep course registration and important details in sight.",
                      query: "When does course registration close?",
                      label: "Explore registration",
                    },
                  ].map((topic) => (
                    <button
                      className="topic-card"
                      key={topic.title}
                      onClick={() => void submit(topic.query)}
                    >
                      <span className="topic-icon">{topic.icon}</span>
                      <h3>{topic.title}</h3>
                      <p>{topic.description}</p>
                      <span className="topic-link">
                        {topic.label}
                        <ArrowRight size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={15} /> Clear sources. Honest limits.
            </span>
            <p>A fictional handbook for learning how retrieval works.</p>
            <button onClick={() => openHandbook()}>
              About this collection <ExternalLink size={12} />
            </button>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialog}
        className="handbook-dialog"
        aria-labelledby="handbook-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">THE SOURCE COLLECTION</span>
            <h2 id="handbook-title">
              {selectedSource?.title ?? "The student handbook"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close handbook"
            onClick={() => dialog.current?.close()}
          >
            <X size={21} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="collection-notice">
            <ShieldCheck size={18} />
            <p>
              Original synthetic fixture for RAG Build Lab. This handbook does
              not represent a real university.
            </p>
          </div>
          {(selectedSource ? [selectedSource] : sections).map((source) => (
            <article className="handbook-section" key={source.id}>
              <span className="eyebrow">
                SECTION {source.section.toUpperCase()} · VERSION{" "}
                {source.version}
              </span>
              <h3>{source.title}</h3>
              <p>{source.text}</p>
              {selectedSource ? (
                <>
                  <div className="citation-box">
                    <span>CITATION</span>
                    <p>{source.citationLabel}</p>
                    <code>{source.id}</code>
                  </div>
                  <div className="source-actions">
                    <button
                      className="text-button"
                      onClick={() => void copySource(source)}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "Copied" : "Copy passage & citation"}
                    </button>
                    <a
                      className="text-button"
                      href={`/api/sources/${encodeURIComponent(source.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source record <ExternalLink size={14} />
                    </a>
                  </div>
                  <details className="source-metadata">
                    <summary>Source metadata</summary>
                    <dl>
                      <dt>Content hash</dt>
                      <dd>{source.contentHash}</dd>
                      <dt>Corpus revision</dt>
                      <dd>{corpusVersion}</dd>
                    </dl>
                  </details>
                </>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setSelectedSource(source)}
                >
                  Inspect source <ArrowRight size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="dialog-footer">
          <span>{sections.length} sections · Synthetic data</span>
          {selectedSource ? (
            <button
              className="text-button"
              onClick={() => setSelectedSource(null)}
            >
              View all sections <ArrowRight size={14} />
            </button>
          ) : (
            <button
              className="text-button"
              onClick={() => dialog.current?.close()}
            >
              Back to search <ArrowRight size={14} />
            </button>
          )}
        </div>
      </dialog>
    </div>
  );
}
