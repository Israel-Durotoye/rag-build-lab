"use client";

import {
  ArrowUp,
  CornerDownRight,
  Eraser,
  MessageSquarePlus,
  Microchip,
  Square,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { getCodes } from "@/lib/api";
import { flashPattern, plural } from "@/lib/text";
import type { CodeRow, RetrievalMode, Selection } from "@/lib/types";
import { AnswerView } from "./answer";
import { useFinder } from "./finder-provider";
import { Onboarding } from "./onboarding";
import { useRunnableMode } from "./search-view";
import { Alert, PageHead, Spinner } from "./ui";
import styles from "./chat-view.module.css";

const MODE: Record<RetrievalMode, string> = {
  hybrid: "Hybrid search",
  keyword: "Keyword search",
  semantic: "Semantic search",
};

interface Example {
  question: string;
  from: "code" | "recent";
}

/** A question about one code of the library, written so Finder reads the code back. */
function codeQuestion(row: CodeRow): string {
  const flash = row.scheme === "flash" ? flashPattern(row.code) : null;
  if (flash)
    return `What do ${flash.long} long and ${flash.short} short flashes mean?`;
  return `What does ${row.display} mean?`;
}

/**
 * Up to three codes: one that means different things on different models
 * first, then one of each other kind, then any. A flash pattern with no long
 * flashes reads oddly as a question, so it comes last.
 */
function pickCodes(rows: CodeRow[]): CodeRow[] {
  const odd = (row: CodeRow) => flashPattern(row.code)?.long === 0;
  const ordered = [
    ...rows.filter((row) => row.differs && !odd(row)),
    ...rows.filter((row) => !row.differs && !odd(row)),
    ...rows.filter(odd),
  ];
  const picked: CodeRow[] = [];
  for (const row of ordered)
    if (picked.length < 3 && !picked.some((p) => p.scheme === row.scheme))
      picked.push(row);
  for (const row of ordered)
    if (picked.length < 3 && !picked.includes(row)) picked.push(row);
  return picked;
}

/**
 * Three questions to start from, all taken from this library: codes its
 * manuals define (one that means different things on different models
 * first) and the reader's own recent searches. Nothing is made up, so a
 * library without codes or history offers fewer.
 */
function Examples({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  const { library, recent, selection } = useFinder();
  const [rows, setRows] = useState<CodeRow[] | null>(null);
  const titleId = useId();
  const version = library?.corpusVersion;

  useEffect(() => {
    const controller = new AbortController();
    getCodes({}, controller.signal)
      .then((matrix) => setRows(matrix.rows))
      .catch(() => {
        if (!controller.signal.aborted) setRows([]);
      });
    return () => controller.abort();
  }, [version]);

  // Codes the chosen model's manual has, when a model is chosen.
  const pool = (rows ?? []).filter(
    (row) => !selection.model || Boolean(row.cells[selection.model]),
  );
  const fromCodes: Example[] = pickCodes(pool).map((row) => ({
    question: codeQuestion(row),
    from: "code",
  }));
  const fromRecent: Example[] = recent
    .filter((question) => !fromCodes.some((e) => e.question === question))
    .map((question) => ({ question, from: "recent" }));
  // Two codes and one recent search; whatever is missing comes from the other.
  const examples = [
    ...fromCodes.slice(0, 2),
    ...fromRecent.slice(0, 1),
    ...fromCodes.slice(2),
    ...fromRecent.slice(1),
  ].slice(0, 3);
  const codes = examples.some((e) => e.from === "code");
  const searches = examples.some((e) => e.from === "recent");
  const source =
    codes && searches
      ? "Built from your library: codes its manuals define, and your recent searches."
      : codes
        ? "Built from codes your manuals define."
        : searches
          ? "From your recent searches."
          : "Ask about a code or a symptom in the box below.";

  return (
    <section className={styles.examples} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.examplesTitle}>
        Start with a question
      </h2>
      {rows === null ? (
        <Spinner label="Looking for examples in your library…" />
      ) : (
        <p className="muted">{source}</p>
      )}
      {examples.length > 0 && rows !== null && (
        <ul className={styles.exampleList}>
          {examples.map((example) => (
            <li key={example.question}>
              <button
                type="button"
                className={styles.example}
                onClick={() => onAsk(example.question)}
                disabled={disabled}
              >
                <span>{example.question}</span>
                <small>
                  {example.from === "code"
                    ? "A code in your library"
                    : "One of your recent searches"}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Chat page: a conversation about one problem. Each reply is a compact
 * answer; a follow-up builds on the earlier questions of its topic (never on
 * earlier answers), and any reply read as a follow-up can be asked again as
 * a new topic.
 */
export function ChatView() {
  const {
    health,
    library,
    libraryError,
    refreshLibrary,
    modelById,
    selection,
    setSelection,
    setPickerOpen,
    turns,
    topic,
    chat,
    newTopic,
    clearChat,
    stopChat,
  } = useFinder();
  const { mode } = useRunnableMode();
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const hasDocuments = (library?.documents.length ?? 0) > 0;
  const ready = Boolean(health) && hasDocuments;
  const busy = turns.some((turn) => turn.streaming);
  const model = modelById(selection.model);
  const revision = model?.revisions.find((r) => r.id === selection.revision);
  const last = turns[turns.length - 1];
  const growth =
    (last?.answer.length ?? 0) +
    (last?.context ? 1 : 0) +
    (last?.card ? 1 : 0) +
    (last?.done ? 1 : 0);

  // Follow the reply as it streams in, unless the reader has scrolled up.
  useEffect(() => {
    const element = document.scrollingElement;
    if (!element || !turns.length) return;
    const below =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (below < 360) element.scrollTo({ top: element.scrollHeight });
  }, [turns.length, growth]);

  const send = (
    question: string,
    options?: { followUp?: boolean | "auto"; override?: Partial<Selection> },
  ) => {
    if (!question.trim() || !ready) return;
    void chat(question, options);
  };

  const submit = () => {
    if (!draft.trim() || busy) return;
    send(draft);
    setDraft("");
  };

  return (
    <div className={styles.page}>
      {!(library && !hasDocuments) && (
        <PageHead
          eyebrow="Chat"
          title="Work through it, one question at a time"
        >
          Ask about a code or a symptom, then follow up. Earlier questions carry
          over into a follow-up; earlier answers never count as evidence.
        </PageHead>
      )}
      {!health && (
        <Alert tone="bad">
          The Finder backend isn&rsquo;t reachable. If it is starting up, this
          page reconnects on its own; when running it locally, start it with{" "}
          <code>npm run api</code>.
        </Alert>
      )}
      {health &&
        !library &&
        (libraryError ? (
          <Alert tone="bad">
            <div className={styles.retry}>
              <span>{libraryError}</span>
              <button
                type="button"
                className="btn small"
                onClick={() => void refreshLibrary()}
              >
                Try again
              </button>
            </div>
          </Alert>
        ) : (
          <Spinner label="Loading your library…" />
        ))}
      {library && !hasDocuments && <Onboarding />}

      {turns.length > 0 && (
        <ol className={styles.thread} aria-label="Conversation">
          {turns.map((turn) => {
            const conversation = turn.done?.conversation;
            return (
              <li key={turn.id} className={styles.exchange}>
                <div className={styles.question}>
                  <span className="sr-only">You asked: </span>
                  <p>{turn.question}</p>
                </div>
                {conversation?.followUp && (
                  <p className={styles.followUp}>
                    <CornerDownRight size={14} aria-hidden />
                    <span>
                      Read as a follow-up to <q>{conversation.topic[0]}</q>
                    </span>
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      onClick={() => send(turn.question, { followUp: false })}
                    >
                      Ask as a new topic
                    </button>
                  </p>
                )}
                <div className={styles.reply}>
                  <AnswerView
                    compact
                    turn={turn}
                    onChooseModel={(modelId, question) => {
                      setSelection({ model: modelId, revision: null });
                      send(question, {
                        override: { model: modelId, revision: null },
                      });
                    }}
                    onChooseRevision={(modelId, revisionId, question) => {
                      setSelection({ model: modelId, revision: revisionId });
                      send(question, {
                        override: { model: modelId, revision: revisionId },
                      });
                    }}
                    onRetry={(question) =>
                      send(question, { override: turn.selection })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {ready && turns.length === 0 && (
        <Examples onAsk={(question) => send(question)} disabled={busy} />
      )}

      {(ready || turns.length > 0) && (
        <form
          className={`panel ${styles.composer}`}
          aria-label="Ask a question"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className={styles.topic}>
            <p className={styles.topicText}>
              <CornerDownRight size={14} aria-hidden />
              {topic.length > 0 ? (
                <span>
                  Follow-ups build on <q>{topic[0]}</q>
                  {topic.length > 1
                    ? ` and ${plural(topic.length - 1, "later question")}`
                    : ""}
                  <span className={styles.aside}>
                    ; only questions carry over, never answers.
                  </span>
                </span>
              ) : (
                <span>The next question starts a new topic.</span>
              )}
            </p>
            <div className={styles.topicActions}>
              <button
                type="button"
                className="btn quiet small"
                onClick={() => {
                  newTopic();
                  input.current?.focus();
                }}
                disabled={topic.length === 0}
              >
                <MessageSquarePlus size={15} aria-hidden /> New topic
              </button>
              <button
                type="button"
                className="btn quiet small"
                onClick={clearChat}
                disabled={turns.length === 0}
              >
                <Eraser size={15} aria-hidden /> Clear
              </button>
            </div>
          </div>
          <div className={`field ${styles.inputRow}`}>
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
                  submit();
                }
              }}
              placeholder={
                topic.length
                  ? "Ask a follow-up, or a new question"
                  : "Ask about a code or a symptom"
              }
              aria-label="Your question"
              rows={1}
              maxLength={4000}
              disabled={!ready}
            />
            {busy ? (
              <button type="button" className="btn" onClick={stopChat}>
                <Square size={13} fill="currentColor" aria-hidden /> Stop
              </button>
            ) : (
              <button
                type="submit"
                className="btn primary"
                disabled={!ready || !draft.trim()}
              >
                <ArrowUp size={16} aria-hidden /> Send
              </button>
            )}
          </div>
          <div className={styles.foot}>
            <button
              type="button"
              className={`btn quiet small ${styles.model}`}
              onClick={() => setPickerOpen(true)}
              aria-keyshortcuts="m"
              title="Choose the model you're working on (m)"
            >
              <Microchip size={14} aria-hidden />
              {model ? (
                <span>
                  Working on {model.name}
                  {revision ? ` (${revision.label})` : ""}
                </span>
              ) : (
                <span>No model chosen — Finder will ask which</span>
              )}
            </button>
            <span className={styles.hints}>
              {MODE[mode]} · <kbd>Enter</kbd> sends · <kbd>Shift</kbd>+
              <kbd>Enter</kbd> adds a line
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
