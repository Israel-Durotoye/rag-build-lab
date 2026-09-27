"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpenText,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Layers3,
  Loader2,
  Mail,
  MessageSquareText,
  PanelRight,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { extractFile, type ExtractProgress } from "@/lib/extract";
import {
  clearCustomSchool,
  getKbSnapshot,
  getServerKbSnapshot,
  saveCustomSchool,
  sectionsFromDocuments,
  setActiveKb,
  subscribeKb,
} from "@/lib/school";
import type { SearchResult, Source } from "@/lib/types";
import { AnswerPanel } from "./answer-panel";
import { WorkspaceFlow } from "./workspace-flow";

type View = "workspace" | "documents" | "activity" | "guide";
const NAV = [
  { id: "workspace", label: "Workspace", icon: MessageSquareText },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "activity", label: "Recent questions", icon: Clock3 },
  { id: "guide", label: "How it works", icon: GitBranch },
] as const;
const STAGES: Record<ExtractProgress["stage"], string> = {
  reading: "Reading your file",
  text: "Extracting the text",
  ocr: "Reading scanned pages with OCR",
  sections: "Preparing searchable sections",
};

function ExtractionSteps({ progress }: { progress: ExtractProgress }) {
  return (
    <div className="extraction-progress" role="status">
      <Loader2 size={22} className="spin" />
      <strong>{STAGES[progress.stage]}</strong>
      <span>
        {progress.total
          ? `${progress.done ?? 0} of ${progress.total} pages`
          : "This can take a moment for larger files."}
      </span>
      {progress.total && (
        <progress
          value={progress.done ?? 0}
          max={progress.total}
          aria-label="Document extraction progress"
        />
      )}
    </div>
  );
}

export default function CampusDesk({
  generation,
  model,
}: {
  generation: boolean;
  model: string;
}) {
  const kb = useSyncExternalStore(
    subscribeKb,
    getKbSnapshot,
    getServerKbSnapshot,
  );
  const doc = kb.school;
  const fileRef = useRef<HTMLInputElement>(null);
  const sourcePanelRef = useRef<HTMLElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<View>("workspace");
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const busy = asking || !!progress;
  const sections = doc ? sectionsFromDocuments(doc.documents) : [];
  const filtered = sections.filter((source) =>
    `${source.title} ${source.text} ${source.location}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const first = doc?.documents[0];
  const meta = first?.metadata ?? {};
  const format =
    meta.format === "pdf"
      ? "PDF"
      : meta.format === "word"
        ? "Word"
        : meta.format === "text"
          ? "Text"
          : "Document";

  function navigate(next: View) {
    setView(next);
    setPanelOpen(false);
    window.scrollTo({ top: 0 });
  }
  function newQuestion() {
    if (busy) return;
    setQuestion("");
    setLastQuestion(null);
    setResult(null);
    setAskError(null);
    setSelectedSource(null);
    navigate("workspace");
    requestAnimationFrame(() => questionRef.current?.focus());
  }
  function openSource(source: Source) {
    setSelectedSource(source);
    setPanelOpen(true);
    setCopied(false);
    setCopyError(false);
    requestAnimationFrame(() => {
      sourcePanelRef.current?.focus({ preventScroll: true });
      if (window.innerWidth <= 1050)
        sourcePanelRef.current?.scrollIntoView({ block: "start" });
    });
  }
  function restore(item: SearchResult) {
    if (busy) return;
    setResult(item);
    setQuestion("");
    setLastQuestion(item.question);
    setSelectedSource(null);
    setAskError(null);
    navigate("workspace");
  }
  async function copySource() {
    if (!selectedSource) return;
    try {
      await navigator.clipboard.writeText(
        `${selectedSource.citationLabel}\n\n${selectedSource.text}`,
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    setExtractError(null);
    setProgress({ stage: "reading" });
    setView("workspace");
    try {
      const extracted = await extractFile(file, setProgress);
      saveCustomSchool({
        name: extracted.name,
        savedAt: new Date().toISOString(),
        documents: extracted.documents,
      });
      setActiveKb("custom");
      setQuestion("");
      setLastQuestion(null);
      setResult(null);
      setHistory([]);
      setAskError(null);
      setSelectedSource(null);
      setFilter("");
    } catch (cause) {
      setExtractError(
        cause instanceof Error ? cause.message : "This file could not be read.",
      );
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function removeDoc() {
    if (busy) return;
    clearCustomSchool();
    setHistory([]);
    setSelectedSource(null);
    setExtractError(null);
    setFilter("");
    newQuestion();
  }
  async function onAsk(event: FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || !doc || busy) return;
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: asked,
          documents: doc.documents,
          ...(lastQuestion ? { previousQuestion: lastQuestion } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        (SearchResult & { error?: string }) | null;
      if (!response.ok || !body)
        throw new Error(body?.error || "Search failed. Try again.");
      setResult(body);
      setLastQuestion(asked);
      setQuestion("");
      setSelectedSource(null);
      setHistory((previous) => [body, ...previous].slice(0, 20));
    } catch (cause) {
      setAskError(
        cause instanceof Error ? cause.message : "Search failed. Try again.",
      );
    } finally {
      setAsking(false);
    }
  }

  const upload = (
    <div
      className="upload-zone"
      data-drag={dragging || undefined}
      aria-busy={!!progress}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFile(event.dataTransfer.files[0]);
      }}
    >
      {progress ? (
        <ExtractionSteps progress={progress} />
      ) : (
        <>
          <span className="upload-illustration">
            <FileText size={29} strokeWidth={1.25} />
            <span>
              <Plus size={13} />
            </span>
          </span>
          <h2>
            {doc
              ? "Replace your document"
              : "Bring your document. We’ll help you find the answer."}
          </h2>
          <p>Drop it here, or choose a file from your computer.</p>
          <button
            className="primary-button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload size={15} />
            Choose a document
            <ArrowUpRight size={14} />
          </button>
          <div className="file-types">
            <span>PDF</span>
            <span>DOCX</span>
            <span>TXT</span>
            <span>MD</span>
            <small>Scanned PDFs supported with OCR</small>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <input
        ref={fileRef}
        id="doc-file"
        type="file"
        accept=".pdf,.docx,.txt,.md"
        onChange={(event) => void handleFile(event.target.files?.[0])}
        disabled={busy}
        hidden
      />
      <aside className="sidebar" aria-label="Workspace navigation">
        <button
          type="button"
          onClick={() => navigate("workspace")}
          className="brand"
          aria-label="Campus Desk workspace"
        >
          <span className="brand-mark">
            <BookOpenText size={21} />
          </span>
          <span>
            Campus<span className="brand-light">Desk</span>
            <small>YOUR DOCUMENT WORKSPACE</small>
          </span>
        </button>
        <button className="new-question" onClick={newQuestion} disabled={busy}>
          <Plus size={16} />
          New question<kbd>＋</kbd>
        </button>
        <p className="sidebar-label">WORKSPACE</p>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === "documents" && (
                <span className="nav-count">{doc?.documents.length ?? 0}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-recents">
          <div className="section-heading">
            <p className="sidebar-label">THIS SESSION</p>
            <span>{history.length.toString().padStart(2, "0")}</span>
          </div>
          {history.length ? (
            history.slice(0, 5).map((item, index) => (
              <button
                key={index}
                className="recent-item"
                onClick={() => restore(item)}
                disabled={busy}
              >
                <MessageSquareText size={13} />
                <span>{item.question}</span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">
              Your questions will appear here.
              <br />
              Start with a document.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Your own reading space</strong>
              <p>
                Documents are saved in this browser. Questions use the search
                server.
              </p>
            </div>
          </div>
          <a className="maker" href="mailto:durotoyeoluwaseunisreal@gmail.com">
            <span className="avatar">ID</span>
            <span>
              <strong>Israel Durotoye</strong>
              <small>Built with curiosity.</small>
            </span>
            <Mail size={14} />
          </a>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Campus Desk</span>
            <ChevronRight size={13} />
            <strong>{NAV.find((item) => item.id === view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="mode-badge">
              <i className="status-dot" />
              {generation ? "AI answers enabled" : "Source search"}
            </span>
            <button
              className="icon-button panel-toggle"
              aria-label={
                panelOpen ? "Hide document panel" : "Show document panel"
              }
              aria-expanded={panelOpen}
              aria-controls="document-panel"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>
        <div className={`workspace-grid ${panelOpen ? "panel-is-open" : ""}`}>
          <main id="main-content" tabIndex={-1}>
            <div className="main-content">
              {view === "workspace" && (
                <>
                  {!result && (
                    <header className="page-heading">
                      <div className="eyebrow">
                        <span className="tiny-line" /> YOUR KNOWLEDGE, WITH
                        CONTEXT
                      </div>
                      <h1>
                        A little clarity.
                        <br />
                        <span>A lot less searching.</span>
                      </h1>
                      <p>
                        A reading desk for the things you need to know.
                        <br className="desktop-break" /> Ask your documents a
                        question. Keep the evidence close.
                      </p>
                    </header>
                  )}
                  {doc && (
                    <div className="active-document">
                      <span className="document-icon">
                        <FileText size={20} />
                      </span>
                      <div>
                        <strong>{doc.name}</strong>
                        <span>
                          {format} · {sections.length} sections ready to search
                        </span>
                      </div>
                      <span className="ready-label">
                        <i className="status-dot" />
                        Ready
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Replace document"
                        onClick={() => fileRef.current?.click()}
                        disabled={busy}
                      >
                        <Upload size={16} />
                      </button>
                    </div>
                  )}
                  {(!doc || progress) && upload}
                  {extractError && (
                    <p className="form-error" role="alert">
                      <AlertTriangle size={15} />
                      {extractError}
                    </p>
                  )}
                  {doc && (
                    <>
                      {result && (
                        <AnswerPanel
                          key={`${result.question}-${result.elapsedMs}`}
                          result={result}
                          model={model}
                          onSource={openSource}
                        />
                      )}
                      {!result && (
                        <div className="suggestions">
                          <div className="section-heading">
                            <h3>Find a place to start</h3>
                            <span className="subtle">From your document</span>
                          </div>
                          <div className="suggestion-grid">
                            {sections.slice(0, 3).map((source) => (
                              <button
                                key={source.id}
                                disabled={busy}
                                onClick={() => {
                                  setQuestion(
                                    `What does the document say about ${source.title}?`,
                                  );
                                  questionRef.current?.focus();
                                }}
                              >
                                <FileText size={15} />
                                <span>{source.title}</span>
                                <ArrowUpRight size={14} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <form className="ask-form" onSubmit={onAsk}>
                        <label htmlFor="question">
                          {lastQuestion
                            ? "Ask a follow-up"
                            : "Ask your document"}
                        </label>
                        <div className="composer">
                          <textarea
                            ref={questionRef}
                            id="question"
                            value={question}
                            onChange={(event) =>
                              setQuestion(event.target.value)
                            }
                            placeholder="What would you like to know?"
                            maxLength={4000}
                            rows={2}
                            disabled={busy}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing
                              ) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                          />
                          <div className="composer-bottom">
                            <span>
                              <FileText size={12} />
                              {doc.name}
                            </span>
                            <button
                              className="send-button"
                              type="submit"
                              disabled={busy || !question.trim()}
                              aria-label="Ask question"
                            >
                              {asking ? (
                                <Loader2 size={18} className="spin" />
                              ) : (
                                <ArrowUp size={18} />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="composer-hint">
                          <span role="status">
                            {asking
                              ? "Finding the relevant passages…"
                              : "Enter to send · Shift + Enter for a new line"}
                          </span>
                          {lastQuestion && (
                            <button
                              type="button"
                              onClick={newQuestion}
                              disabled={busy}
                            >
                              Clear context
                            </button>
                          )}
                        </div>
                      </form>
                      {askError && (
                        <p className="form-error" role="alert">
                          {askError}
                        </p>
                      )}
                    </>
                  )}
                  {!result && (
                    <>
                      <WorkspaceFlow ready={!!doc} generation={generation} />
                      <div className="feature-row">
                        <article>
                          <BookOpenText size={19} />
                          <div>
                            <h3>Go straight to the source</h3>
                            <p>
                              Every passage keeps its original location. Open
                              it, read it, check it.
                            </p>
                          </div>
                        </article>
                        <article>
                          <Layers3 size={19} />
                          <div>
                            <h3>More than a PDF reader</h3>
                            <p>
                              Search typed text, Word documents and scanned
                              pages in one place.
                            </p>
                          </div>
                        </article>
                      </div>
                    </>
                  )}
                </>
              )}
              {view === "documents" && (
                <>
                  <header className="page-heading compact">
                    <span className="eyebrow">YOUR LIBRARY</span>
                    <h1>Documents</h1>
                    <p>Explore the text behind your answers.</p>
                  </header>
                  {doc ? (
                    <>
                      <div className="library-header">
                        <div>
                          <h2>{doc.name}</h2>
                          <p>
                            {format} · {sections.length} searchable sections
                          </p>
                        </div>
                        <button
                          className="secondary-button"
                          onClick={() => fileRef.current?.click()}
                          disabled={busy}
                        >
                          <Upload size={14} />
                          Replace
                        </button>
                      </div>
                      <label className="section-search">
                        <Search size={16} />
                        <input
                          aria-label="Filter document sections"
                          placeholder="Find a section or phrase…"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                        />
                      </label>
                      <div className="section-heading">
                        <span className="eyebrow">DOCUMENT OUTLINE</span>
                        <span className="subtle">
                          {filtered.length} of {sections.length} sections
                        </span>
                      </div>
                      <div className="document-list">
                        {filtered.map((source, index) => (
                          <button
                            className="document-row"
                            key={source.id}
                            onClick={() => openSource(source)}
                          >
                            <span className="row-number">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span>
                              <strong>{source.title}</strong>
                              <small>
                                {source.text.slice(0, 135)}
                                {source.text.length > 135 ? "…" : ""}
                              </small>
                            </span>
                            <span className="location">{source.location}</span>
                            <ArrowUpRight size={15} />
                          </button>
                        ))}
                        {!filtered.length && (
                          <p className="empty-state">
                            No sections match “{filter}”. Try a different word.
                          </p>
                        )}
                      </div>
                      <button
                        className="text-button remove-button"
                        onClick={removeDoc}
                        disabled={busy}
                      >
                        <Trash2 size={14} />
                        Remove document from this browser
                      </button>
                    </>
                  ) : (
                    <>
                      {upload}
                      <p className="below-upload">
                        Once added, your document’s sections will appear here
                        for browsing.
                      </p>
                    </>
                  )}
                </>
              )}
              {view === "activity" && (
                <>
                  <header className="page-heading compact">
                    <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
                    <h1>Recent questions</h1>
                    <p>
                      Your last {history.length || "few"} questions from this
                      session. Select one to revisit its sources.
                    </p>
                  </header>
                  {history.length ? (
                    <div className="history-list">
                      {history.map((item, index) => (
                        <button
                          key={index}
                          onClick={() => restore(item)}
                          disabled={busy}
                        >
                          <MessageSquareText size={18} />
                          <span>
                            <strong>{item.question}</strong>
                            <small>
                              {item.sources.length}{" "}
                              {item.sources.length === 1 ? "source" : "sources"}{" "}
                              ·{" "}
                              {item.status === "generated"
                                ? "AI answer"
                                : item.status === "insufficient_evidence"
                                  ? "No evidence found"
                                  : "Source search"}
                            </small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Clock3 size={30} />
                      <h2>A fresh page.</h2>
                      <p>
                        Ask your first question and you can return to it here.
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => navigate("workspace")}
                      >
                        Go to workspace
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  <p className="below-upload">
                    Question history lasts for this page session and clears when
                    you replace a document.
                  </p>
                </>
              )}
              {view === "guide" && (
                <>
                  <header className="page-heading compact">
                    <span className="eyebrow">A LOOK UNDER THE HOOD</span>
                    <h1>
                      Good answers start
                      <br />
                      <span>with the right context.</span>
                    </h1>
                    <p>
                      Here’s what happens between adding a file and finding an
                      answer.
                    </p>
                  </header>
                  <WorkspaceFlow
                    ready={!!doc}
                    generation={generation}
                    expanded
                  />
                  <div className="guide-note">
                    <ShieldCheck size={21} />
                    <div>
                      <h3>Know where your document goes</h3>
                      <p>
                        Files are read in your browser and the extracted text is
                        saved here. When you ask a question, document sections
                        are sent to the search server
                        {generation
                          ? ", and relevant passages are shared with the configured model provider"
                          : ""}
                        . Scanned-page OCR may download language files. Remove a
                        document from the Documents view to clear its saved
                        copy.
                      </p>
                    </div>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => navigate("workspace")}
                  >
                    Back to workspace
                    <ArrowRight size={15} />
                  </button>
                </>
              )}
              <footer className="workspace-footer">
                <span>
                  Campus Desk <span className="footer-divider">/</span> A RAG
                  Build Lab project
                </span>
                <span>Read. Ask. Understand.</span>
              </footer>
            </div>
          </main>
          <aside
            className="context-panel"
            id="document-panel"
            ref={sourcePanelRef}
            tabIndex={-1}
            aria-label="Document details and sources"
          >
            <div className="panel-heading">
              <h2>{selectedSource ? "Source preview" : "Document overview"}</h2>
              {selectedSource ? (
                <button
                  className="icon-button"
                  aria-label="Back to document overview"
                  onClick={() => {
                    setSelectedSource(null);
                    setPanelOpen(false);
                    if (window.innerWidth <= 1050)
                      document.getElementById("main-content")?.focus();
                  }}
                >
                  <X size={15} />
                </button>
              ) : (
                <FileText size={15} />
              )}
            </div>
            {selectedSource ? (
              <div className="source-preview">
                <span className="source-location">
                  <FileText size={13} />
                  {selectedSource.location}
                </span>
                <h3>{selectedSource.title}</h3>
                <p className="preview-document">
                  {selectedSource.documentTitle}
                </p>
                <div className="source-full-text">{selectedSource.text}</div>
                <button
                  className="secondary-button copy-source"
                  onClick={copySource}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Citation copied" : "Copy citation"}
                </button>
                {copyError && (
                  <p className="form-error" role="alert">
                    Select the source text to copy it; clipboard access is
                    unavailable.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`document-preview ${doc ? "has-document" : ""}`}
                >
                  <div className="paper-preview" aria-hidden>
                    <span className="paper-corner" />
                    <BookOpenText size={24} />
                    <span className="paper-line long" />
                    <span className="paper-line" />
                    <span className="paper-line long" />
                    <span className="paper-line short" />
                    <div className="paper-highlight" />
                    <span className="paper-line" />
                    <span className="paper-line long" />
                  </div>
                  <span className="preview-badge">
                    {doc ? format : "WAITING FOR A DOCUMENT"}
                  </span>
                </div>
                <div className="panel-document-info">
                  <h3>{doc?.name ?? "Your source of truth"}</h3>
                  <p>
                    {doc
                      ? "Added to this browser. Ready to explore."
                      : "Add a document to see its details, sections and original passages here."}
                  </p>
                </div>
                <dl className="document-stats">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {doc ? (
                        <>
                          <i className="status-dot" />
                          Ready to search
                        </>
                      ) : (
                        "No document"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Sections</dt>
                    <dd>{doc ? sections.length : "—"}</dd>
                  </div>
                  <div>
                    <dt>Pages</dt>
                    <dd>
                      {typeof meta.pages === "number" && meta.pages > 0
                        ? meta.pages
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Answer mode</dt>
                    <dd>{generation ? "AI + sources" : "Source excerpts"}</dd>
                  </div>
                </dl>
                {meta.truncated === true && (
                  <p className="panel-warning">
                    This file was trimmed to the searchable size limit.
                  </p>
                )}
                {meta.ocrFailed === true && (
                  <p className="panel-warning">
                    Some scanned pages could not be read.
                  </p>
                )}
                {doc && (
                  <div className="panel-outline">
                    <div className="section-heading">
                      <span className="eyebrow">
                        {result ? "RETRIEVED SOURCES" : "QUICK LOOK"}
                      </span>
                      <span className="subtle">
                        {result ? result.sources.length : sections.length}
                      </span>
                    </div>
                    {(result ? result.sources : sections.slice(0, 4)).map(
                      (source) => (
                        <button
                          key={source.id}
                          onClick={() => openSource(source)}
                        >
                          <FileText size={14} />
                          <span>
                            {source.title}
                            <small>{source.location}</small>
                          </span>
                          <ChevronRight size={13} />
                        </button>
                      ),
                    )}
                    {result && !result.sources.length && (
                      <p className="subtle">
                        No passages were retrieved for this question.
                      </p>
                    )}
                    <button
                      className="text-button browse-all"
                      onClick={() => navigate("documents")}
                    >
                      Browse all sections
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
                <div className="desk-tip">
                  <span className="eyebrow">
                    <BookOpenText size={13} /> A NOTE FROM THE DESK
                  </span>
                  <p>
                    {doc
                      ? "Specific questions work best. Try a topic, a requirement or a phrase from your document."
                      : "A handbook, a course guide, a policy. Start with one document you’ve been meaning to understand."}
                  </p>
                </div>
                {!doc && (
                  <button
                    className="panel-upload"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    <ArrowDownToLine size={14} />
                    Add your first document
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
