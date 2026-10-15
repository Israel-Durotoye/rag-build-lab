import type {
  AnswerStatus,
  Candidate,
  Clarification,
  CodeScheme,
  ContextItem,
  FaultCard,
  Mention,
  ModelRef,
  RevisionRef,
  Turn,
} from "@/lib/types";

/**
 * Helpers the answer parts share. Pure functions: they read what the
 * backend returned and never call it.
 */

/** Text as two manuals' passages are compared: no case, punctuation or spacing. */
export function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * A code as it is written into a question so that Finder reads it back. A
 * flash pattern is shown "4 long · 4 short" but asked as "4 long, 4 short".
 */
export function askable(display: string, scheme: CodeScheme): string {
  return scheme === "flash" ? display.replace(/\s*·\s*/g, ", ") : display;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The question with one code swapped for another ("Did you mean E71?"). The
 * code is looked for as the question wrote it; when it isn't there (it came
 * from an earlier question of a chat), the new code is asked on its own.
 */
export function withCode(
  question: string,
  written: string[],
  replacement: string,
): string {
  for (const raw of written) {
    if (!raw.trim()) continue;
    const found = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(raw)}(?!\\p{N})`,
      "iu",
    ).exec(question);
    if (!found) continue;
    let end = found.index + found[0].length;
    // A pattern read as "4 long and 4 short flash" leaves "es" behind.
    if (/\p{L}$/u.test(found[0]))
      while (end < question.length && /\p{L}/u.test(question[end])) end += 1;
    const word = /\s+((?:flash|blink)\p{L}*)$/iu.exec(
      question.slice(found.index, end),
    )?.[1];
    return (
      question.slice(0, found.index) +
      replacement +
      (word ? ` ${word}` : "") +
      question.slice(end)
    );
  }
  return replacement;
}

/**
 * The question with the models it names replaced by ``name`` (and any
 * revision named with them dropped). Mention spans count characters the way
 * the backend does, in code points.
 */
export function renamed(
  question: string,
  mentions: Mention[],
  name: string,
): string {
  const named = mentions.filter(
    (m) => m.kind === "model" || m.kind === "family" || m.kind === "revision",
  );
  if (!named.length) return question;
  const chars = Array.from(question);
  for (const mention of [...named].sort((a, b) => b.start - a.start)) {
    chars.splice(
      mention.start,
      mention.end - mention.start,
      mention.kind === "revision" ? "" : name,
    );
  }
  return chars
    .join("")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .trim();
}

/**
 * "Same question, other model": when the question itself named its model,
 * that name becomes the other model's, so Finder doesn't see two models and
 * ask which one is meant.
 */
export function questionFor(turn: Turn, otherName: string): string {
  const identify = turn.identify;
  if (!identify || identify.chosen.source !== "question") return turn.question;
  return renamed(turn.question, identify.mentions, otherName);
}

/**
 * What to ask once a model is chosen from Finder's question. A question that
 * named a family ("Pi 3") or a model other than the one chosen would be
 * asked about again, so the chosen model's name takes the named one's place.
 */
export function questionForChoice(
  clarification: Clarification,
  mentions: Mention[],
  candidate: Candidate,
): string {
  const question = clarification.question;
  if (candidate.kind === "revision" || clarification.reason === "no_model")
    return question;
  const named = mentions.filter(
    (m) => m.kind === "model" || m.kind === "family",
  );
  const alreadyNamed =
    named.length > 0 &&
    named.every(
      (m) =>
        m.kind === "model" &&
        m.models.length === 1 &&
        m.models[0] === candidate.id,
    );
  return alreadyNamed ? question : renamed(question, mentions, candidate.name);
}

export type ItemPresence = "same" | "only" | "partly";

/** How one side of a comparison stands against the other. */
export interface SideDiff {
  /** Per context item: all, none or some of its lines are in the other side's context. */
  items: Record<number, ItemPresence>;
  /** Lines (`${n}:${unitId}`) that only this side's context holds. */
  only: Set<string>;
}

/** Marks for "Same question, other model": which passages one side has that the other doesn't. */
export function compareSides(
  mine: ContextItem[],
  theirs: ContextItem[],
): SideDiff {
  const other = new Set(
    theirs.flatMap((item) =>
      item.units.filter((u) => !u.masked).map((u) => comparable(u.text)),
    ),
  );
  const items: Record<number, ItemPresence> = {};
  const only = new Set<string>();
  for (const item of mine) {
    const lines = item.units.filter((u) => !u.masked);
    let shared = 0;
    for (const unit of lines) {
      if (other.has(comparable(unit.text))) shared += 1;
      else only.add(`${item.n}:${unit.id}`);
    }
    items[item.n] =
      shared === lines.length ? "same" : shared === 0 ? "only" : "partly";
  }
  return { items, only };
}

/** A fault card's standing against the other side's card for the same code. */
export type CardMark = "same" | "differs" | "only";

export function cardMarks(
  mine: FaultCard | null,
  theirs: FaultCard | null,
): CardMark | null {
  if (mine?.kind !== "found") return null;
  if (theirs?.kind === "not_found" && theirs.code === mine.code) return "only";
  if (theirs?.kind !== "found" || theirs.code !== mine.code) return null;
  return comparable(mine.meaning) === comparable(theirs.meaning)
    ? "same"
    : "differs";
}

/** One plain line for each way an answer can end. */
export function statusText(
  status: AnswerStatus,
  model: ModelRef | null,
  revision: RevisionRef | null,
  askingRevision = false,
): string {
  const manual = model ? `the ${model.short} manual` : "the library";
  switch (status) {
    case "answered":
      return "Written from the passages below. Each number points to the passage it cites.";
    case "uncited":
      return "This answer cites none of the passages below, so check it against them before relying on it.";
    case "not_found":
      return "The passages don't answer this question. The closest ones are below.";
    case "interrupted":
      return "The answer stopped before it was finished. Check what arrived against the passages below.";
    case "unavailable":
      return "The model couldn't be reached, so these are the manual's own sentences, not a written answer.";
    case "sources_only":
      return "No model is set up on this server, so these are the manual's own sentences, not a written answer.";
    case "no_passages":
      return `Nothing in ${manual}${revision ? ` (${revision.label})` : ""} matched this question, so no answer was written. Try the words the manual would use, or a code.`;
    case "clarification":
      return askingRevision
        ? "Finder needs to know which revision this is before it answers."
        : "Finder needs to know which model this is before it answers.";
  }
}

/** Statuses whose explanation was written by the model. */
export const WRITTEN: ReadonlySet<AnswerStatus> = new Set([
  "answered",
  "uncited",
  "not_found",
  "interrupted",
]);

/** Scroll a passage into view, focus it and let it flash briefly. */
export function revealSource(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: still ? "auto" : "smooth",
    block: "center",
  });
  element.focus({ preventScroll: true });
}

/** The DOM ID of passage ``n`` of one answer. */
export function sourceId(turnId: string, n: number): string {
  return `${turnId}-passage-${n}`;
}
