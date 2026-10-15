"use client";

import {
  ArrowRight,
  Clock,
  Hash,
  Library,
  Microchip,
  Search,
  Square,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { suggestCodes } from "@/lib/api";
import { plural } from "@/lib/text";
import { runnableMode } from "@/lib/turns";
import type {
  CodeSuggestion,
  Health,
  RetrievalMode,
  Selection,
} from "@/lib/types";
import { AnswerView } from "./answer";
import { askable } from "./answer/shared";
import { SEARCH_INPUT_ID } from "./app-shell";
import { CodeDisplay } from "./code-display";
import { useFinder } from "./finder-provider";
import { Onboarding } from "./onboarding";
import { Alert, ModelTags, Spinner } from "./ui";
import styles from "./search-view.module.css";

type SemanticStatus = Health["embeddings"]["status"];

const MODES: { mode: RetrievalMode; label: string; hint: string }[] = [
  {
    mode: "hybrid",
    label: "Hybrid",
    hint: "Exact words and meaning together, fused by rank",
  },
  {
    mode: "keyword",
    label: "Keyword",
    hint: "The exact words and codes of the question",
  },
  {
    mode: "semantic",
    label: "Semantic",
    hint: "The passages closest in meaning",
  },
];

const SEMANTIC_REASON: Record<Exclude<SemanticStatus, "ready">, string> = {
  off: "Semantic search is off on this server, so Finder searches by keyword.",
  loading:
    "The semantic model is still loading. Finder searches by keyword until it is ready.",
  failed:
    "The semantic model couldn't be loaded on this server, so Finder searches by keyword.",
};

/** The search mode questions run in now, and the embedding model's state. */
export function useRunnableMode(): {
  mode: RetrievalMode;
  semantic: SemanticStatus | null;
} {
  const { health, mode } = useFinder();
  const semantic = health?.embeddings.status ?? null;
  return { mode: runnableMode(mode, semantic), semantic };
}

// ---------------------------------------------------------------- code suggestions

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const COUNT = `(\\d{1,2}|${NUMBER_WORDS.join("|")})`;
// An LED pattern as it is typed: "4 lo", "4 long", "four long flashes, 4",
// "4 long and 4 sh".
const FLASH_TAIL = new RegExp(
  `(?:^|\\s)(${COUNT}\\s+(?:lo|lon|long(?:\\s+(?:fl|bl)\\p{L}*)?` +
    `(?:\\s*(?:,|and|then|followed\\s+by|\\+|\\/|-)?\\s*(?:and\\s+)?${COUNT}` +
    `(?:\\s+s\\p{L}*(?:\\s+(?:fl|bl)\\p{L}*)?)?)?))$`,
  "iu",
);
// A prefix and its number written apart: "GPIO 22", "E 17", "exit status 7".
const SPLIT_TAIL = /(?:^|\s)((?:exit\s+status|[a-z]{1,6})\s\d{1,5})$/i;
// One word with letters and digits: "e17", "E-17", "gpio22", "0x27", "[pi3".
const TOKEN_TAIL = /(?:^|\s)(\[?[\p{L}\p{N}][\p{L}\p{N}+:_-]*\]?)$/u;

function count(word: string): number {
  const index = NUMBER_WORDS.indexOf(word.toLowerCase());
  return index >= 0 ? index : Number(word);
}

/**
 * The code being typed at the end of the question, if the last word looks
 * like one: where it starts and what to look up. An LED pattern is looked up
 * by its canonical form ("FLASH:L4S" while the short flashes are still being
 * typed), anything else as typed.
 */
export function codeFragment(
  text: string,
): { start: number; query: string } | null {
  const flash = FLASH_TAIL.exec(text);
  if (flash) {
    const short = flash[3] === undefined ? "" : String(count(flash[3]));
    return {
      start: flash.index + flash[0].length - flash[1].length,
      query: `FLASH:L${count(flash[2])}S${short}`,
    };
  }
  const split = SPLIT_TAIL.exec(text);
  if (split)
    return {
      start: split.index + split[0].length - split[1].length,
      query: split[1],
    };
  const token = TOKEN_TAIL.exec(text);
  if (token && /\p{L}/u.test(token[1]) && /\p{N}/u.test(token[1]))
    return {
      start: token.index + token[0].length - token[1].length,
      query: token[1],
    };
  return null;
}

// ---------------------------------------------------------------- the page

function LibrarySummary() {
  const { library } = useFinder();
  if (!library) return null;
  return (
    <section className={styles.summary} aria-label="Your library">
      <Link href="/library" className={styles.tile}>
        <Library size={18} aria-hidden />
        <span>
          <strong>{plural(library.documents.length, "manual")}</strong>
          <small>in your library</small>
        </span>
      </Link>
      <Link href="/models" className={styles.tile}>
        <Microchip size={18} aria-hidden />
        <span>
          <strong>{plural(library.models.length, "model")}</strong>
          <small>Which model do I have?</small>
        </span>
      </Link>
      <Link href="/codes" className={styles.tile}>
        <Hash size={18} aria-hidden />
        <span>
          <strong>Codes</strong>
          <small>Every code, model by model</small>
        </span>
      </Link>
      <p className={styles.keys}>
        <kbd>/</kbd> jumps to the search box from any page; <kbd>m</kbd> opens
        the model picker. Both can be turned off in{" "}
        <Link href="/settings">Settings</Link>.
      </p>
    </section>
  );
}

/**
 * The Search page: one question at a time, answered from the manual of the
 * model being worked on. Codes are suggested while they're typed.
 */
export function SearchView() {
  const {
    health,
    library,
    libraryError,
    refreshLibrary,
    modelById,
    selection,
    setSelection,
    setPickerOpen,
    setMode,
    search,
    runSearch,
    recent,
    stop,
  } = useFinder();
  const { mode, semantic } = useRunnableMode();
  const [query, setQuery] = useState(() => search?.question ?? "");
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<AbortController | null>(null);
  const listId = useId();
  const modeLabelId = useId();
  const modeNoteId = useId();
  const hasDocuments = (library?.documents.length ?? 0) > 0;
  const open = suggestions.length > 0;
  const model = modelById(selection.model);
  const revision = model?.revisions.find((r) => r.id === selection.revision);

  // "/" on another page comes here with ?focus=1.
  useEffect(() => {
    if (!hasDocuments) return;
    if (new URLSearchParams(window.location.search).get("focus") === "1")
      input.current?.focus();
  }, [hasDocuments]);

  // A lookup still waiting when the page goes away is dropped.
  useEffect(() => {
    const timers = timer;
    const requests = pending;
    return () => {
      window.clearTimeout(timers.current);
      requests.current?.abort();
    };
  }, []);

  // Keep the highlighted suggestion in view.
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listId}-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const closeSuggestions = () => {
    window.clearTimeout(timer.current);
    pending.current?.abort();
    setSuggestions([]);
    setActive(-1);
  };

  const lookUp = (value: string, atEnd: boolean) => {
    window.clearTimeout(timer.current);
    pending.current?.abort();
    const fragment = atEnd ? codeFragment(value) : null;
    if (!fragment) {
      setSuggestions([]);
      setActive(-1);
      return;
    }
    const forModel = selection.model;
    timer.current = window.setTimeout(() => {
      const controller = new AbortController();
      pending.current = controller;
      suggestCodes(fragment.query, forModel, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setSuggestions(found.slice(0, 8));
          setActive(-1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 200);
  };

  const choose = (suggestion: CodeSuggestion) => {
    const written = askable(suggestion.display, suggestion.scheme);
    const fragment = codeFragment(query);
    const next = fragment
      ? `${query.slice(0, fragment.start)}${written}`
      : `${query}${query && !query.endsWith(" ") ? " " : ""}${written}`;
    setQuery(next);
    closeSuggestions();
    input.current?.focus();
  };

  const ask = (question: string, override?: Partial<Selection>) => {
    closeSuggestions();
    setQuery(question);
    void runSearch(question, override);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) ask(query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (
      event.key === "Enter" &&
      active >= 0 &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    }
  };

  return (
    <div className={styles.page}>
      {!health && (
        <>
          {!library && <h1 className="sr-only">Search</h1>}
          <Alert tone="bad">
            The Finder backend isn&rsquo;t reachable. If it is starting up, this
            page reconnects on its own; when running it locally, start it with{" "}
            <code>npm run api</code>.
          </Alert>
        </>
      )}
      {health && !library && (
        <>
          <h1 className="sr-only">Search</h1>
          {libraryError ? (
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
          )}
        </>
      )}
      {library && !hasDocuments && <Onboarding />}

      {library && hasDocuments && (
        <>
          <header className={styles.hero}>
            <span className="eyebrow">Search</span>
            <h1>Find the exact passage</h1>
            <p className="lead">
              Type a fault code, an LED pattern or a symptom. Finder answers
              from the manual of the model you&rsquo;re working on and shows the
              passages it used.
            </p>
          </header>

          <form
            role="search"
            aria-label="Search the manuals"
            className={styles.form}
            onSubmit={submit}
          >
            <div className={styles.box}>
              <div className={`field field-lg ${styles.field}`}>
                <Search size={20} aria-hidden className={styles.icon} />
                <input
                  id={SEARCH_INPUT_ID}
                  ref={input}
                  type="text"
                  value={query}
                  onChange={(event) => {
                    const { value, selectionStart } = event.target;
                    setQuery(value);
                    lookUp(value, selectionStart === value.length);
                  }}
                  onKeyDown={onKeyDown}
                  onBlur={closeSuggestions}
                  placeholder="A code, an LED pattern or a symptom"
                  aria-label="Question or code"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-activedescendant={
                    active >= 0 ? `${listId}-option-${active}` : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  maxLength={4000}
                />
                {search?.streaming && (
                  <button
                    type="button"
                    className="btn"
                    onClick={stop}
                    aria-label="Stop the answer"
                  >
                    <Square size={13} fill="currentColor" aria-hidden />
                    <span className={styles.buttonText}>Stop</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!query.trim()}
                  aria-label="Search"
                >
                  <span className={styles.buttonText}>Search</span>
                  <ArrowRight size={17} aria-hidden />
                </button>
              </div>
              <ul
                id={listId}
                role="listbox"
                aria-label="Codes in your library"
                className={`popover ${styles.suggestions}`}
                hidden={!open}
                onMouseDown={(event) => event.preventDefault()}
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.code}
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={styles.option}
                    onClick={() => choose(suggestion)}
                    onMouseEnter={() => setActive(index)}
                  >
                    <CodeDisplay
                      code={suggestion.code}
                      display={suggestion.display}
                      scheme={suggestion.scheme}
                      size="small"
                    />
                    <span className={styles.meaning}>{suggestion.meaning}</span>
                    <span className={styles.optionModels}>
                      <ModelTags models={suggestion.models} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.under}>
              <p className={styles.who}>
                <Microchip size={16} aria-hidden className={styles.icon} />
                {model ? (
                  <span>
                    Working on <strong>{model.name}</strong>
                    {revision ? ` (${revision.label})` : ""}
                  </span>
                ) : (
                  <span>No model chosen — Finder will ask which</span>
                )}
                <button
                  type="button"
                  className="btn quiet small"
                  onClick={() => setPickerOpen(true)}
                  aria-keyshortcuts="m"
                >
                  {model ? "Change" : "Choose a model"} <kbd aria-hidden>m</kbd>
                </button>
              </p>
              <div
                className={styles.modes}
                role="group"
                aria-labelledby={modeLabelId}
                aria-describedby={
                  semantic && semantic !== "ready" ? modeNoteId : undefined
                }
              >
                <span id={modeLabelId} className={styles.modeLabel}>
                  Search by
                </span>
                <div className="seg">
                  {MODES.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={mode === option.mode}
                      disabled={
                        option.mode !== "keyword" && semantic !== "ready"
                      }
                      title={option.hint}
                      onClick={() => setMode(option.mode)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {semantic && semantic !== "ready" && (
              <p id={modeNoteId} className={styles.modeNote}>
                {SEMANTIC_REASON[semantic]}
              </p>
            )}

            {recent.length > 0 && (
              <div className={styles.recent}>
                <span className={styles.recentLabel}>
                  <Clock size={14} aria-hidden /> Recent
                </span>
                <ul className={styles.recentList} aria-label="Recent searches">
                  {recent.map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        className={`chip ${styles.recentChip}`}
                        title={question}
                        onClick={() => ask(question)}
                      >
                        <span>{question}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>

          {search ? (
            <div className={styles.result}>
              {search.question !== query.trim() && (
                <p className={styles.asked}>
                  The answer to <q>{search.question}</q>
                </p>
              )}
              <AnswerView
                turn={search}
                onChooseModel={(modelId, question) => {
                  setSelection({ model: modelId, revision: null });
                  ask(question, { model: modelId, revision: null });
                }}
                onChooseRevision={(modelId, revisionId, question) => {
                  setSelection({ model: modelId, revision: revisionId });
                  ask(question, { model: modelId, revision: revisionId });
                }}
                onRetry={(question) => ask(question, search.selection)}
              />
            </div>
          ) : (
            <LibrarySummary />
          )}
        </>
      )}
    </div>
  );
}
