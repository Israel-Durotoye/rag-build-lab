import {
  ArrowRight,
  FileText,
  Layers3,
  MessageSquareText,
  Search,
} from "lucide-react";

export function WorkspaceFlow({
  ready,
  generation,
  expanded = false,
}: {
  ready: boolean;
  generation: boolean;
  expanded?: boolean;
}) {
  return (
    <section
      className={`workflow ${expanded ? "workflow-expanded" : ""}`}
      aria-label="How document search works"
    >
      <div className="section-heading">
        <span className="eyebrow">FROM DOCUMENT TO ANSWER</span>
        <span className="subtle">Three steps. Every source in view.</span>
      </div>
      <div className="flow-canvas">
        <div className="flow-node">
          <span className="node-icon">
            <FileText size={20} />
          </span>
          <div>
            <small>01 / ADD</small>
            <strong>Your document</strong>
            <span>PDF, Word or text</span>
          </div>
          <i className={ready ? "status-dot" : "status-dot idle"} />
        </div>
        <div className="flow-connector" aria-hidden>
          <ArrowRight size={14} />
        </div>
        <div className="flow-node">
          <span className="node-icon">
            <Search size={20} />
          </span>
          <div>
            <small>02 / FIND</small>
            <strong>Relevant passages</strong>
            <span>Search by your question</span>
          </div>
        </div>
        <div className="flow-connector" aria-hidden>
          <ArrowRight size={14} />
        </div>
        <div className="flow-node">
          <span className="node-icon">
            <MessageSquareText size={20} />
          </span>
          <div>
            <small>03 / CHECK</small>
            <strong>
              {generation ? "A grounded answer" : "Source excerpts"}
            </strong>
            <span>Read the original context</span>
          </div>
        </div>
        <div className="flow-caption">
          <Layers3 size={13} />
          <span>Page locations stay attached from extraction to answer.</span>
        </div>
      </div>
      {expanded && (
        <div className="flow-explanations">
          <article>
            <span>01</span>
            <h3>Start with the original</h3>
            <p>
              Your browser extracts the document’s text. Scanned PDF pages use
              OCR, then the text is split into searchable sections. The document
              stays in this browser until you ask a question.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>Find the useful parts</h3>
            <p>
              Your question and document sections are sent to the search
              endpoint. Keyword matching ranks the passages; you can open each
              one and see its original page or section.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Keep the evidence close</h3>
            <p>
              {generation
                ? "The configured model uses retrieved passages to write an answer. Citation IDs are checked, and the original text is available for you to review."
                : "This workspace shows matching excerpts directly. No model is configured to write an answer. You can still inspect sources and copy their citations."}
            </p>
          </article>
        </div>
      )}
    </section>
  );
}
