"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { Fragment, useState } from "react";
import { useRag } from "./rag-provider";
import { formatMs, LayerIntro, NoTurnYet, Stat, TurnPicker } from "./ui";

const KIND_LABEL = {
  instructions: "System instructions",
  history: "Earlier conversation",
  context: "Retrieved passages + your question",
} as const;

/** Highlight the "[n] Document — Title (p. 3)" header of each passage. */
function ContextText({ content }: { content: string }) {
  return (
    <>
      {content.split("\n").map((line, index) => (
        <Fragment key={index}>
          {/^\[\d+\] /.test(line) ? (
            <span className="passage-header">{line}</span>
          ) : line.startsWith("Question: ") ? (
            <span className="question-line">{line}</span>
          ) : (
            line
          )}
          {"\n"}
        </Fragment>
      ))}
    </>
  );
}

export function AugmentationView() {
  const { inspected: turn } = useRag();
  const [copied, setCopied] = useState(false);
  if (!turn) return <NoTurnYet layer="augmentation" />;
  const trace = turn.augmentation;

  const intro = (
    <LayerIntro step={2} title="Augmentation: building the prompt">
      This is where your document meets the model. Nothing is trained or
      fine-tuned: the retrieved passages are pasted into the prompt, numbered,
      next to your question, with instructions to answer only from them and cite
      their numbers. Below is exactly what the model receives.
    </LayerIntro>
  );
  if (!trace)
    return (
      <div className="layer">
        {intro}
        <TurnPicker />
        <p className="muted">
          <Loader2 size={14} className="spin" aria-hidden /> Waiting for
          retrieval…
        </p>
      </div>
    );

  const { stats } = trace;
  const passagesChars = Math.max(0, stats.contextChars);
  const segments = [
    { key: "system", label: "Instructions", chars: stats.systemChars },
    { key: "history", label: "Conversation", chars: stats.historyChars },
    { key: "passages", label: "Passages", chars: passagesChars },
    { key: "question", label: "Question", chars: stats.questionChars },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          trace.messages.map(({ role, content }) => ({ role, content })),
          null,
          2,
        ),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="layer">
      {intro}
      <TurnPicker />

      <section className="card">
        <p className="card-step">Prompt size</p>
        <div
          className="budget"
          role="img"
          aria-label="What the prompt is made of"
        >
          {segments.map((s) =>
            s.chars > 0 ? (
              <span
                key={s.key}
                data-part={s.key}
                style={{ flexGrow: s.chars }}
                title={`${s.label}: ${s.chars.toLocaleString()} characters`}
              />
            ) : null,
          )}
        </div>
        <p className="legend">
          {segments.map((s) => (
            <Fragment key={s.key}>
              <span data-part={s.key} /> {s.label}{" "}
              {s.chars.toLocaleString()}{" "}
            </Fragment>
          ))}
        </p>
        <div className="stats">
          <Stat label="Passages" value={trace.passages.length} />
          <Stat label="Characters" value={stats.totalChars.toLocaleString()} />
          <Stat
            label="≈ Tokens"
            value={stats.estimatedTokens.toLocaleString()}
            hint="About four characters per token for English text"
          />
          <Stat label="Built in" value={formatMs(trace.ms)} />
        </div>
      </section>

      <section className="card">
        <p className="card-step">Passage numbers the model can cite</p>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Section</th>
              <th>Where</th>
              <th>Characters</th>
            </tr>
          </thead>
          <tbody>
            {trace.passages.map((p) => (
              <tr key={p.id}>
                <td>[{p.n}]</td>
                <td>{p.title}</td>
                <td>
                  {p.docName} · {p.location}
                </td>
                <td>{p.chars.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!trace.passages.length && (
          <p className="muted">
            No passages: the model is told nothing matched.
          </p>
        )}
      </section>

      <div className="section-row">
        <h3 className="section-title">The messages sent to the model</h3>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check size={14} aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
      <div className="messages">
        {trace.messages.map((m, index) => (
          <details
            key={index}
            className="message"
            data-role={m.role}
            open={m.kind !== "instructions"}
          >
            <summary>
              <span className="role">{m.role}</span> {KIND_LABEL[m.kind]}
              <small>{m.content.length.toLocaleString()} characters</small>
            </summary>
            <pre>
              {m.kind === "context" ? (
                <ContextText content={m.content} />
              ) : (
                m.content
              )}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
