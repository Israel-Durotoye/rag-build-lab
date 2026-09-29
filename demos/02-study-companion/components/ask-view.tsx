"use client";

import {
  AlertTriangle,
  ArrowUp,
  BookOpenText,
  Brain,
  Check,
  CornerDownRight,
  Loader2,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatMs, plural } from "@/lib/text";
import type { Chunking, RetrievalMode, Turn } from "@/lib/types";
import { Markdown } from "./markdown";
import { useStudy } from "./study-provider";
import {
  BudgetMeter,
  Caveats,
  CHUNKING_LABEL,
  LabLink,
  SourceCard,
  STATUS_TEXT,
} from "./ui";

const MODES: { mode: RetrievalMode; label: string }[] = [
  { mode: "hybrid", label: "Keywords + meaning" },
  { mode: "keyword", label: "Keywords only" },
  { mode: "semantic", label: "Meaning only" },
];

function Progress({ turn }: { turn: Turn }) {
  const following =
    turn.stage === "rewrite" || turn.retrieval?.rewrite.followUp === true;
  const steps = [
    ...(following
      ? [{ key: "rewrite", label: "Reading it as a follow-up" }]
      : []),
    { key: "retrieval", label: "Searching your notes" },
    { key: "context", label: "Building the context" },
    { key: "generation", label: turn.answer ? "Writing" : "Thinking" },
  ];
  const order = ["rewrite", "retrieval", "context", "generation"];
  const at = order.indexOf(turn.stage);
  return (
    <ol className="progress-line" aria-label="Progress">
      {steps.map((step) => {
        const index = order.indexOf(step.key);
        const state = index < at ? "done" : index === at ? "current" : "todo";
        return (
          <li key={step.key} data-state={state}>
            {state === "done" ? (
              <Check size={12} strokeWidth={3} aria-hidden />
            ) : state === "current" ? (
              <Loader2 size={12} className="spin" aria-hidden />
            ) : (
              <span className="dot" aria-hidden />
            )}
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function FollowUpNote({ turn }: { turn: Turn }) {
  const { ask, streaming } = useStudy();
  const rewrite = turn.retrieval?.rewrite;
  if (!rewrite?.followUp) return null;
  return (
    <p className="followup">
      <CornerDownRight size={14} aria-hidden />
      <span>
        Read as a follow-up to <q>{rewrite.carried[0]}</q>. Your notes were
        searched for <q>{rewrite.query.replace(/\n/g, " · ")}</q>.
      </span>
      {turn.stage === "done" && (
        <button
          type="button"
          className="link"
          disabled={streaming}
          onClick={() => void ask(turn.question, false)}
        >
          Ask it as a new topic
        </button>
      )}
    </p>
  );
}

function Reply({ turn }: { turn: Turn }) {
  const { ask, inspect, streaming } = useStudy();
  const [open, setOpen] = useState<number | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const done = turn.done;
  const sources = done?.sources ?? [];
  const cited = new Set(done?.citations.map((c) => c.n));
  const working = !["done", "error", "stopped"].includes(turn.stage);
  const extractive = done?.explanation ?? null;
  const quoted = new Set(extractive?.sentences.map((s) => s.n));
  const quiet = done?.status === "answered" || done?.status === "not_found";
  // Until a citation is clicked, the first section the answer leans on is open.
  const leaned = cited.size ? cited : quoted;
  const firstShown = leaned.size
    ? Math.min(...leaned)
    : (sources[0]?.n ?? null);

  const cite = (n: number) => {
    setOpen(n);
    requestAnimationFrame(() =>
      sourcesRef.current
        ?.querySelector(`[data-n="${n}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };

  return (
    <article className="reply">
      {working && <Progress turn={turn} />}
      <FollowUpNote turn={turn} />

      {turn.reasoning && working && !turn.answer && (
        <details className="thinking" open>
          <summary>
            <Brain size={14} aria-hidden /> Thinking…
          </summary>
          <p>{turn.reasoning.slice(-600)}</p>
        </details>
      )}

      {turn.answer && (
        <section className="answer" data-streaming={working || undefined}>
          <h3 className="part-title">Explanation</h3>
          <Markdown text={turn.answer} onCite={cite} />
        </section>
      )}

      {done && !quiet && (
        <p className={`note note-${done.status}`}>
          {done.status === "unavailable" || done.status === "interrupted" ? (
            <AlertTriangle size={14} aria-hidden />
          ) : null}
          {STATUS_TEXT[done.status]}
          {done.generation.error && done.status === "unavailable"
            ? ` (${done.generation.error})`
            : ""}
        </p>
      )}

      {extractive && extractive.sentences.length > 0 && (
        <section className="answer answer-verbatim">
          <h3 className="part-title">From your notes, word for word</h3>
          {extractive.sentences.map((sentence) => (
            <blockquote key={`${sentence.n}-${sentence.text}`}>
              {sentence.text}{" "}
              <button
                type="button"
                className="cite"
                onClick={() => cite(sentence.n)}
                aria-label={`Show source ${sentence.n}`}
              >
                {sentence.n}
              </button>
            </blockquote>
          ))}
          <p className="fine">{extractive.label}</p>
        </section>
      )}

      {done && <Caveats caveats={done.caveats} />}

      {turn.retrieval?.weak && done && done.status !== "not_found" && (
        <p className="note">
          <AlertTriangle size={14} aria-hidden /> None of your notes contain the
          words of this question. The sections below are only the nearest in
          meaning and may be unrelated.
        </p>
      )}

      {turn.stage === "error" && (
        <p className="note note-unavailable" role="alert">
          <AlertTriangle size={14} aria-hidden /> {turn.error}
          <button
            type="button"
            className="link"
            disabled={streaming}
            onClick={() => void ask(turn.question)}
          >
            <RotateCcw size={13} aria-hidden /> Try again
          </button>
        </p>
      )}
      {turn.stage === "stopped" && <p className="note">Stopped.</p>}

      {sources.length > 0 && done && (
        <section className="sources" ref={sourcesRef}>
          <h3 className="part-title">
            Supporting sections
            <small>
              {done.status === "answered"
                ? `${plural(cited.size, "section")} cited of ${sources.length} given to the model`
                : plural(sources.length, "section")}
              {" · "}
              {CHUNKING_LABEL[turn.chunking].toLowerCase()} chunks
            </small>
          </h3>
          {turn.context && <BudgetMeter budget={turn.context.budget} />}
          {sources.map((source) => (
            <div key={`${source.id}-${open === source.n}`} data-n={source.n}>
              <SourceCard
                item={source}
                cited={cited.has(source.n)}
                defaultOpen={(open ?? firstShown) === source.n}
              />
            </div>
          ))}
        </section>
      )}

      {(done || turn.retrieval) && (
        <footer className="reply-footer">
          <span>How this was made:</span>
          {(
            [
              ["/retrieval", "Retrieval"],
              ["/context", "Context"],
              ["/generation", "Generation"],
            ] as const
          ).map(([href, label]) => (
            <Link key={href} href={href} onClick={() => inspect(turn.id)}>
              {label}
            </Link>
          ))}
          <LabLink question={turn.retrieval?.query ?? turn.question} />
          {done?.timings.totalMs != null && (
            <span className="muted">{formatMs(done.timings.totalMs)}</span>
          )}
        </footer>
      )}
    </article>
  );
}

function Starters() {
  const { documents, sample, ask, streaming, overviewPending } = useStudy();
  const written = (documents ?? []).flatMap((d) => d.overview?.questions ?? []);
  const bundled = sample?.loaded
    ? sample.questions.filter((q) => !q.previous).map((q) => q.question)
    : [];
  const starters = [...new Set([...written, ...bundled])].slice(0, 4);
  const pending = Object.values(overviewPending).some(Boolean);
  return (
    <section className="ask-welcome">
      <h1>
        Ask about <em>your notes</em>
      </h1>
      <p className="muted">
        You get three things back: an explanation, the exact sections behind it,
        and the original text.
      </p>
      {starters.length > 0 ? (
        <div className="suggestions">
          {starters.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => void ask(question, false)}
              disabled={streaming}
            >
              {question}
            </button>
          ))}
        </div>
      ) : pending ? (
        <p className="muted">
          <Loader2 size={13} className="spin" aria-hidden /> Preparing
          suggestions from your notes…
        </p>
      ) : null}
    </section>
  );
}

export function AskView() {
  const {
    health,
    documents,
    turns,
    streaming,
    topic,
    ask,
    stop,
    newTopic,
    clearConversation,
    mode,
    setMode,
    chunking,
    setChunking,
    expand,
    setExpand,
    draft,
    setDraft,
    settings,
  } = useStudy();
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = !!health && (documents?.length ?? 0) > 0;
  const last = turns.at(-1);

  // Follow the answer as it streams, unless the reader scrolled up.
  useEffect(() => {
    const element = document.scrollingElement;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 240;
    if (nearBottom) element.scrollTo({ top: element.scrollHeight });
  }, [last?.answer, last?.reasoning, last?.stage, turns.length]);

  useEffect(() => {
    if (draft) input.current?.focus();
  }, [draft]);

  const send = () => {
    if (!draft.trim() || !ready || streaming) return;
    void ask(draft);
    setDraft("");
  };

  return (
    <div className="ask-layout">
      <div className="chat">
        {!health && (
          <p className="banner" role="alert">
            <AlertTriangle size={15} aria-hidden /> The Study Companion backend
            isn&rsquo;t reachable. If it is starting up, this page reconnects on
            its own; when running locally, start it with{" "}
            <code>npm run api</code>.
          </p>
        )}
        {health && documents && documents.length === 0 && (
          <p className="banner banner-info">
            <BookOpenText size={15} aria-hidden /> You have no notes yet.{" "}
            <Link href="/notes">Add your notes</Link> or load the sample notes
            to start asking questions.
          </p>
        )}
        <div className="thread">
          {turns.length === 0
            ? ready && <Starters />
            : turns.map((turn) => (
                <div key={turn.id} className="exchange">
                  <p className="question">{turn.question}</p>
                  <Reply turn={turn} />
                </div>
              ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {topic.length > 0 && !streaming && (
            <p className="topic">
              <CornerDownRight size={13} aria-hidden />
              <span>
                Following up on <q>{topic[0]}</q>
                {topic.length > 1 &&
                  ` and ${plural(topic.length - 1, "more question")}`}
                . Only your questions are carried over, never an earlier answer.
              </span>
              <button
                type="button"
                className="link"
                onClick={() => {
                  newTopic();
                  input.current?.focus();
                }}
                title="The next question starts a new topic"
              >
                <X size={13} aria-hidden /> New topic
              </button>
            </p>
          )}
          <div className="composer-input">
            <textarea
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={
                !ready
                  ? "Add notes first"
                  : topic.length
                    ? "Ask a follow-up, or a new question…"
                    : "Ask about your notes…"
              }
              rows={1}
              maxLength={4000}
              disabled={!ready}
              aria-label="Your question"
            />
            {streaming ? (
              <button
                type="button"
                className="send"
                onClick={stop}
                aria-label="Stop"
              >
                <Square size={14} fill="currentColor" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                className="send"
                disabled={!ready || !draft.trim()}
                aria-label="Send"
              >
                <ArrowUp size={17} aria-hidden />
              </button>
            )}
          </div>
          <div className="composer-bar">
            <label
              className="field field-inline"
              title="How your notes are cut into chunks"
            >
              <span>Chunks</span>
              <select
                value={chunking}
                onChange={(event) =>
                  setChunking(event.target.value as Chunking)
                }
                disabled={streaming}
              >
                <option value="section">Section-aware</option>
                <option value="fixed">
                  Fixed-length
                  {settings ? ` (${settings.settings.chunkWords} words)` : ""}
                </option>
              </select>
            </label>
            <label className="field field-inline" title="How chunks are found">
              <span>Search by</span>
              <select
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as RetrievalMode)
                }
                disabled={streaming}
              >
                {MODES.filter(
                  (m) =>
                    m.mode === "keyword" || health?.embeddings.status !== "off",
                ).map((m) => (
                  <option key={m.mode} value={m.mode}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="check"
              title="A small match grows to its whole section when that fits the word budget"
            >
              <input
                type="checkbox"
                checked={expand}
                onChange={(event) => setExpand(event.target.checked)}
                disabled={streaming}
              />
              <span>Expand small matches</span>
            </label>
            <span className="grow" />
            {turns.length > 0 && !streaming && (
              <button
                type="button"
                className="link"
                onClick={clearConversation}
              >
                Reset conversation
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
