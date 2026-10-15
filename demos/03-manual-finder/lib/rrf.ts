import type { LabFused } from "./types";

/**
 * Reciprocal rank fusion, exactly as the backend computes it
 * (rag_core/web/retrieval.py, `fuse`): a passage scores the sum of
 * 1 / (constant + rank) over the rankings that returned it. Only ranks are
 * combined, because a BM25 score and a cosine similarity are on different
 * scales.
 *
 * Scores are compared as exact fractions, so two passages tie only when
 * their sums are truly equal. A tie goes to the passage that one ranking
 * placed higher (its best single rank), then to the smaller passage ID; the
 * order never depends on the order of the inputs.
 */

export type TieBreak = "best-rank" | "id";

interface Fraction {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function add(a: Fraction, b: Fraction): Fraction {
  const num = a.num * b.den + b.num * a.den;
  const den = a.den * b.den;
  const divisor = gcd(num, den) || 1;
  return { num: num / divisor, den: den / divisor };
}

/** Negative when a < b, zero when equal, positive when a > b. */
function compare(a: Fraction, b: Fraction): number {
  return a.num * b.den - b.num * a.den;
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function fuse(
  rankings: [string[], string[]],
  constant: number,
  tieBreak: TieBreak = "best-rank",
): LabFused[] {
  if (!Number.isInteger(constant) || constant < 1)
    throw new RangeError(
      "The RRF constant must be a whole number of 1 or more.",
    );
  const ranks = new Map<string, [number | null, number | null]>();
  rankings.forEach((ranking, position) => {
    [...new Set(ranking)].forEach((id, index) => {
      const found = ranks.get(id) ?? [null, null];
      found[position] = index + 1;
      ranks.set(id, found);
    });
  });
  const entries = [...ranks].map(([id, found]) => {
    const present = found.filter((r): r is number => r !== null);
    const score = present.reduce<Fraction>(
      (sum, rank) => add(sum, { num: 1, den: constant + rank }),
      { num: 0, den: 1 },
    );
    return { id, ranks: found, score, bestRank: Math.min(...present) };
  });
  entries.sort(
    (a, b) =>
      compare(b.score, a.score) ||
      (tieBreak === "best-rank" ? a.bestRank - b.bestRank : 0) ||
      byId(a.id, b.id),
  );
  return entries.map((entry, index) => ({
    id: entry.id,
    rank: index + 1,
    score: Math.round((entry.score.num / entry.score.den) * 1e6) / 1e6,
    ranks: entry.ranks,
    bestRank: entry.bestRank,
    tied: entries.some(
      (other) => other !== entry && compare(other.score, entry.score) === 0,
    ),
  }));
}

/** The arithmetic behind one fused score, e.g. "1/(60+2) + 1/(60+5)". */
export function arithmetic(
  ranks: [number | null, number | null],
  constant: number,
): string {
  return ranks
    .filter((rank): rank is number => rank !== null)
    .map((rank) => `1/(${constant}+${rank})`)
    .join(" + ");
}
