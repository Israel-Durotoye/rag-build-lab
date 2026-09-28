"use client";

import {
  AlertTriangle,
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  Loader2,
  RotateCcw,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RetrievalMode, Turn } from "@/lib/types";
import { Markdown } from "./markdown";
import { useRag } from "./rag-provider";
import { formatMs, PassageCard, plural, STATUS_TEXT, titleCase } from "./ui";

const MODES: { mode: RetrievalMode; label: string }[] = [
  { mode: "hybrid", label: "Keywords + meaning" },
  { mode: "keyword", label: "Keywords only" },
  { mode: "semantic", label: "Meaning only" },
];

function Progress({ turn }: { turn: Turn }) {
  const rewriting =
    turn.stage === "rewrite" || turn.retrieval?.rewrite.method !== "none";
  const steps = [
    ...(rewriting
      ? [{ key: "rewrite", label: "Understanding the follow-up" }]
      : []),
    { key: "retrieval", label: "Finding passages" },
    { key: "augmentation", label: "Preparing the prompt" },
    { key: "generation", label: turn.answer ? "Writing" : "Thinking" },
  ];
  const order = ["rewrite", "retrieval", "augmentation", "generation"];
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

function Reply({ turn }: { turn: Turn }) {
  const { ask, inspect, streaming } = useRag();
  const [open, setOpen] = useState<number | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const done = turn.done;
  const sources = done?.sources ?? [];
  const cited = new Set(done?.citations.map((c) => c.n));
  const working = !["done", "error", "stopped"].includes(turn.stage);
  const showSources =
    sources.length > 0 && (done?.status !== "uncited" || cited.size > 0);

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
      <span className="reply-mark" aria-hidden>
        CG
      </span>
      <div className="reply-body">
        {working && <Progress turn={turn} />}

        {turn.reasoning && working && !turn.answer && (
          <details className="thinking" open>
            <summary>
              <Brain size={14} aria-hidden /> Thinking…
            </summary>
            <p>{turn.reasoning.slice(-600)}</p>
          </details>
        )}

        {turn.answer && (
          <div className="answer" data-streaming={working || undefined}>
            <Markdown text={turn.answer} onCite={cite} />
          </div>
        )}

        {done && done.status !== "answered" && done.status !== "not_found" && (
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

        {showSources && (
          <div className="sources" ref={sourcesRef}>
            <p className="sources-label">
              {done?.status === "answered"
                ? `Sources · ${plural(cited.size, "passage")} cited`
                : `Passages found · ${sources.length}`}
            </p>
            {sources
              .filter((s) => done?.status !== "answered" || cited.has(s.n!))
              .map((source) => (
                <div
                  key={`${source.id}-${open === source.n}`}
                  data-n={source.n}
                >
                  <PassageCard
                    passage={source}
                    label={source.n}
                    cited={cited.has(source.n!)}
                    defaultOpen={open === source.n}
                  />
                </div>
              ))}
          </div>
        )}

        {(done || turn.retrieval) && (
          <footer className="reply-footer">
            <span>How this was made:</span>
            {(
              [
                ["/retrieval", "Retrieval"],
                ["/augmentation", "Augmentation"],
                ["/generation", "Generation"],
              ] as const
            ).map(([href, label]) => (
              <Link key={href} href={href} onClick={() => inspect(turn.id)}>
                {label}
              </Link>
            ))}
            {done?.timings.totalMs != null && (
              <span className="muted">{formatMs(done.timings.totalMs)}</span>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}

function Starters() {
  const { profile, profileState, ask, streaming } = useRag();
  const starters = profile?.quickActions.slice(0, 4) ?? [];
  return (
    <section className="ask-welcome">
      <h1>
        {profile?.institution ? (
          <>
            Ask about <em>{titleCase(profile.institution)}</em>
          </>
        ) : (
          <>
            Ask about <em>your documents</em>
          </>
        )}
      </h1>
      <p className="muted">
        Short answers from the library, with the page each fact comes from.
      </p>
      {starters.length > 0 ? (
        <div className="suggestions">
          {starters.map((action) => (
            <button
              key={action.question}
              type="button"
              onClick={() => void ask(action.question)}
              disabled={streaming}
            >
              {action.question}
            </button>
          ))}
        </div>
      ) : profileState === "writing" || profileState === "loading" ? (
        <p className="muted">
          <Loader2 size={13} className="spin" aria-hidden /> Preparing
          suggestions from your documents…
        </p>
      ) : null}
    </section>
  );
}

export function ChatView() {
  const {
    health,
    documents,
    turns,
    streaming,
    ask,
    stop,
    clearChat,
    mode,
    setMode,
    draft,
    setDraft,
  } = useRag();
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
            <AlertTriangle size={15} aria-hidden /> The Campus Guide backend
            isn&rsquo;t reachable. If it is starting up, this page reconnects on
            its own; when running locally, start it with{" "}
            <code>npm run api</code>.
          </p>
        )}
        {health && documents && documents.length === 0 && (
          <p className="banner banner-info">
            <BookOpen size={15} aria-hidden /> The library is empty.{" "}
            <Link href="/library">Add your school&rsquo;s documents</Link> to
            start asking questions.
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
              ready ? "Ask a question…" : "Add documents to the library first"
            }
            rows={1}
            maxLength={4000}
            disabled={!ready}
            aria-label="Your question"
          />
          <div className="composer-bar">
            <label className="mode" title="How passages are found">
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
            {turns.length > 0 && !streaming && (
              <button type="button" className="link" onClick={clearChat}>
                New conversation
              </button>
            )}
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
        </form>
      </div>
      <AskRail />
    </div>
  );
}

function AskRail() {
  const { documents, profile, turns, inspect, ask, streaming } = useRag();
  const last = turns.at(-1);
  const starters = profile?.quickActions.slice(0, 5) ?? [];
  return (
    <aside className="ask-rail">
      <section className="rail-block">
        <h3>
          <BookOpen size={15} aria-hidden /> In the library
        </h3>
        {documents?.length ? (
          <ul className="rail-docs">
            {documents.slice(0, 5).map((d) => (
              <li key={d.id}>
                <span>{d.name}</span>
                <small>
                  {d.pages
                    ? plural(d.pages, "page")
                    : plural(d.chunks, "passage")}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing yet.</p>
        )}
        <Link href="/library" className="link">
          Manage the library
        </Link>
      </section>
      {starters.length > 0 && (
        <section className="rail-block">
          <h3>Try asking</h3>
          <ul className="rail-starters">
            {starters.map((action) => (
              <li key={action.question}>
                <button
                  type="button"
                  onClick={() => void ask(action.question)}
                  disabled={streaming}
                >
                  {action.question}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {last?.done && (
        <section className="rail-block">
          <h3>Behind the last answer</h3>
          <ul className="rail-links">
            {(
              [
                [
                  "/retrieval",
                  "Retrieval",
                  `${last.done.sources.length} passages found`,
                ],
                [
                  "/augmentation",
                  "Augmentation",
                  `${last.augmentation?.stats.estimatedTokens.toLocaleString() ?? "—"} tokens in the prompt`,
                ],
                [
                  "/generation",
                  "Generation",
                  `${last.done.citations.length} citations checked`,
                ],
              ] as const
            ).map(([href, label, detail]) => (
              <li key={href}>
                <Link href={href} onClick={() => inspect(last.id)}>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
