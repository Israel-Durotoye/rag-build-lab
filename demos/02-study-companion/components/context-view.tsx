"use client";

import { ArrowRight, Minus } from "lucide-react";
import { formatMs, plural } from "@/lib/text";
import { useStudy } from "./study-provider";
import {
  BudgetMeter,
  Caveats,
  CHUNKING_LABEL,
  LayerIntro,
  NoTurnYet,
  SourceCard,
  Stat,
} from "./ui";

const KIND_LABEL = {
  instructions: "Instructions: the rules, and how to explain",
  context: "Context: the sections, earlier questions and the question",
} as const;

export function ContextView() {
  const { inspected } = useStudy();
  const trace = inspected?.context;
  const retrieval = inspected?.retrieval;
  const intro = (
    <LayerIntro step={2} title="Context">
      Deciding what the model gets to read. A retrieved chunk can be a fragment;
      here small fragments grow to their whole section while the total stays
      inside a word budget, and the result is written into the prompt.
    </LayerIntro>
  );
  if (!inspected || !trace || !retrieval)
    return (
      <>
        {intro}
        <NoTurnYet layer="context" />
      </>
    );
  const { budget, prompt, items } = trace;
  const expanded = items.filter((item) => item.expanded).length;

  return (
    <div className="layer">
      {intro}

      <div className="stats stats-wide">
        <Stat label="Chunking" value={CHUNKING_LABEL[trace.chunking]} />
        <Stat label="Chunks retrieved" value={retrieval.selected.length} />
        <Stat label="Sections in context" value={items.length} />
        <Stat
          label="Grew to a section"
          value={budget.expansion ? expanded : "off"}
          hint={`Matches under ${budget.expandBelowWords} words are expanded`}
        />
        <Stat
          label="Prompt size"
          value={`~${prompt.stats.estimatedTokens.toLocaleString("en")} tokens`}
          hint="About four characters to a token"
        />
      </div>

      <section className="card">
        <h2 className="card-title">From matches to context</h2>
        <BudgetMeter budget={budget} />
        <p className="fine">
          Sections are added in rank order. A match under{" "}
          {budget.expandBelowWords} words that is only part of its section is
          replaced by the whole section, if that still fits {budget.budgetWords}{" "}
          words. The top match is always kept.
          {!budget.expansion &&
            " Expansion was switched off for this question."}
        </p>
        <ol className="flow">
          {retrieval.selected.map((id, index) => {
            const chunk = retrieval.chunks[id];
            const item = items.find((i) => i.matchedChunkIds.includes(id));
            const skipped = budget.skipped.filter((s) => s.chunkId === id);
            const first = item?.matchedChunkIds[0] === id;
            return (
              <li key={id} data-outcome={item ? "kept" : "left-out"}>
                <span className="rank">{index + 1}</span>
                <span className="source-title">
                  <strong>{chunk?.title ?? id}</strong>
                  <small>
                    {chunk
                      ? `${chunk.pieces > 1 ? `window ${chunk.piece} of ${chunk.pieces} · ` : ""}${plural(chunk.words, "word")}`
                      : ""}
                  </small>
                </span>
                {item ? (
                  <ArrowRight size={14} aria-hidden />
                ) : (
                  <Minus size={14} aria-hidden />
                )}
                <span className="flow-outcome">
                  {!item
                    ? `Left out: ${skipped.at(-1)?.reason ?? "it did not fit the budget"}`
                    : !first
                      ? `Already covered by section ${item.n}`
                      : item.expanded
                        ? `Grew to its whole section (${plural(item.words, "word")}) → section ${item.n}`
                        : `Kept as it is → section ${item.n}`}
                  {item && first && skipped.length > 0 && (
                    <small> · could not grow: {skipped[0].reason}</small>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {!retrieval.selected.length && (
          <p className="muted">
            Nothing was retrieved, so the context is empty.
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section>
          <h2 className="section-title">What the model was given</h2>
          {items.map((item) => (
            <SourceCard key={item.id} item={item} />
          ))}
          <p className="fine">
            Index revision <code>{trace.corpusVersion.slice(0, 12)}</code> ·
            each section carries a content hash, so a changed note is a
            different source · built in {formatMs(trace.ms)}
          </p>
        </section>
      )}

      <Caveats caveats={trace.caveats} />
      {trace.caveats.length > 0 && (
        <p className="fine">
          These sentences are picked from the context by rule, not by a model:
          they contain a qualifier such as “not”, “unless” or “except” and share
          words with the question. They are shown beside the answer whatever the
          explanation says.
        </p>
      )}

      <section>
        <h2 className="section-title">The prompt, exactly as sent</h2>
        {prompt.earlierQuestions.length > 0 && (
          <p className="fine">
            {plural(prompt.earlierQuestions.length, "earlier question")} went
            along so the follow-up makes sense. No earlier answer did.
          </p>
        )}
        {prompt.messages.map((message) => (
          <details
            key={message.kind}
            className="prompt"
            open={message.kind === "context"}
          >
            <summary>
              <span className="tag">{message.role}</span>{" "}
              {KIND_LABEL[message.kind]}
              <small>
                {message.content.length.toLocaleString("en")} characters
              </small>
            </summary>
            <pre>{message.content}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
