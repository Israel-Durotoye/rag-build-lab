/** Scoring and ordering for practice sessions. Pure functions, tested in web-tests. */

export interface QuizScore {
  answered: number;
  correct: number;
  total: number;
  /** Whole-number percentage of the questions answered so far. */
  percent: number;
  /** IDs of the questions answered wrongly, in the order they were asked. */
  missed: string[];
}

export function scoreQuiz(
  items: { id: string; answer: number }[],
  chosen: Record<string, number>,
): QuizScore {
  const answered = items.filter((item) => item.id in chosen);
  const missed = answered
    .filter((item) => chosen[item.id] !== item.answer)
    .map((item) => item.id);
  const correct = answered.length - missed.length;
  return {
    answered: answered.length,
    correct,
    total: items.length,
    percent: answered.length
      ? Math.round((correct / answered.length) * 100)
      : 0,
    missed,
  };
}

export type CardMark = "known" | "again";

export interface DeckProgress {
  known: number;
  again: number;
  remaining: number;
  done: boolean;
}

export function deckProgress(
  ids: string[],
  marks: Record<string, CardMark>,
): DeckProgress {
  const known = ids.filter((id) => marks[id] === "known").length;
  const again = ids.filter((id) => marks[id] === "again").length;
  return {
    known,
    again,
    remaining: ids.length - known - again,
    done: ids.length > 0 && known + again === ids.length,
  };
}

/** Fisher–Yates shuffle that leaves its input alone. */
export function shuffled<T>(
  items: T[],
  random: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
