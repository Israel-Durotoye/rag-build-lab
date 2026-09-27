import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  FileText,
  MessageSquareText,
} from "lucide-react";
import { useState } from "react";
import type { SearchResult, Source } from "@/lib/types";

export function AnswerPanel({
  result,
  model,
  onSource,
}: {
  result: SearchResult;
  model: string;
  onSource: (source: Source) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const generated = result.status === "generated" && !!result.answer;
  const missing = result.status === "insufficient_evidence";
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        [
          result.question,
          result.answer || result.notice,
          ...result.sources.map(
            (source) => `${source.citationLabel}\n${source.text}`,
          ),
        ].join("\n\n"),
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <section className="results" aria-label="Search result">
      <div className="question-heading">
        <span className="eyebrow">YOUR QUESTION</span>
        <h2>{result.question}</h2>
      </div>
      <article className={`answer ${missing ? "state-insufficient" : ""}`}>
        <header>
          <span className="answer-icon">
            {missing ? (
              <AlertCircle size={18} />
            ) : (
              <MessageSquareText size={18} />
            )}
          </span>
          <div>
            <strong>
              {generated
                ? "Answer"
                : missing
                  ? "Not found in this document"
                  : result.status === "clarification"
                    ? "One more detail needed"
                    : "Here’s what the document says"}
            </strong>
            <small>{generated ? model : "Document search"}</small>
          </div>
          <span className="timing">
            <Clock3 size={12} />
            {(result.elapsedMs / 1000).toFixed(2)}s
          </span>
        </header>
        {generated ? (
          result
            .answer!.split(/\n{2,}/)
            .map((paragraph, index) => <p key={index}>{paragraph}</p>)
        ) : (
          <p>{result.notice}</p>
        )}
        {generated && <p className="answer-note">{result.notice}</p>}
        <div className="answer-bottom">
          <span>
            {result.sources.length}{" "}
            {result.sources.length === 1 ? "source" : "sources"} retrieved
          </span>
          <button className="text-button" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy response"}
          </button>
        </div>
        {copyError && (
          <p className="form-error" role="alert">
            Copy isn’t available in this browser. Select the text to copy it.
          </p>
        )}
      </article>
      {result.sources.length > 0 && (
        <div className="source-results">
          <div className="section-heading">
            <h3>Supporting passages</h3>
            <span className="subtle">Open to read in context</span>
          </div>
          {result.sources.map((source, index) => (
            <button
              className="passage-card"
              key={source.id}
              onClick={() => onSource(source)}
            >
              <span className="passage-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="passage-body">
                <span className="passage-title">
                  {source.title}
                  <ArrowUpRight size={14} />
                </span>
                <span className="passage-excerpt">{source.text}</span>
                <span className="passage-meta">
                  <FileText size={12} />
                  {source.location}
                  {result.citations.includes(source.id) && (
                    <span className="cited-tag">
                      <Check size={11} /> Cited in answer
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <details className="pipeline">
        <summary>How this answer was made</summary>
        <p>
          Your question was matched against the document using{" "}
          {result.retrievalMode === "keyword"
            ? "BM25 keyword search"
            : `${result.retrievalMode} search`}
          .{" "}
          {generated
            ? `${model} composed an answer and its citation IDs were checked against the retrieved passages.`
            : "The passages are shown directly; no generated answer is displayed."}{" "}
          Matching text can still be irrelevant, so check the original context.
        </p>
        {result.retrievalQuery !== result.question && (
          <p>Search query: {result.retrievalQuery}</p>
        )}
      </details>
    </section>
  );
}
