const SMALL_WORDS = new Set([
  "of",
  "and",
  "the",
  "for",
  "in",
  "at",
  "on",
  "to",
  "de",
  "du",
  "la",
]);

/** Names that arrive in ALL CAPS (as documents often print them) read better in title case. */
export function titleCase(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/[a-z][a-z']*/g, (word, offset) =>
      offset > 0 && SMALL_WORDS.has(word)
        ? word
        : word[0].toUpperCase() + word.slice(1),
    );
}
