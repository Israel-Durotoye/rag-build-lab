/** Small text helpers shared by the views. Pure functions, tested in web-tests. */

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? word : many}`;
}

export interface TableText {
  /** The header cells, when the passage is a table row. */
  header: string[] | null;
  /** One array of cells per row. */
  rows: string[][];
}

/**
 * A table-row passage is stored as its header line, then one line per row,
 * cells separated by " | ". Returns the cells, or null when the text is not
 * a table (a paragraph, a list, a note).
 */
export function tableCells(
  text: string,
  header: string | null,
): TableText | null {
  if (!header) return null;
  const lines = text.split("\n").filter((line) => line.trim());
  if (!lines.length) return null;
  // Padding the line keeps blank cells at either edge (" |  | Raspberry Pi 2B").
  const split = (line: string) =>
    ` ${line} `.split(" | ").map((cell) => cell.trim());
  const body = lines[0].trim() === header.trim() ? lines.slice(1) : lines;
  return { header: split(header), rows: body.map(split) };
}

export interface Segment {
  text: string;
  hit: boolean;
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A rough stem, close to the keyword index's Porter stemming, so that a
 * search for "flashing LEDs" marks "flashes" and "LED": common endings are
 * cut from longer words ("supplies" and "supply" both become "suppl").
 */
export function stem(term: string): string {
  if (term.length > 5) {
    const cut = term.replace(/(?:ies|ied|ing|ed|es|ly|y)$/, "");
    if (cut !== term && cut.length >= 3) return cut;
  }
  if (term.length > 3 && /[^s]s$/.test(term)) return term.slice(0, -1);
  return term;
}

/**
 * Split text into segments, marking the words that ``terms`` (the question's
 * words, lower case) match: a longer term by its stem and any ending, a term
 * of up to three letters ("pi", "usb") only as a whole word or plural.
 */
export function highlight(text: string, terms: string[]): Segment[] {
  const usable = [...new Set(terms.map((t) => t.toLowerCase()))]
    .filter((t) => t.length > 1)
    .map((t) =>
      t.length <= 3 ? `${escape(t)}(?:e?s)?` : `${escape(stem(t))}\\w*`,
    )
    .sort((a, b) => b.length - a.length);
  if (!usable.length || !text) return [{ text, hit: false }];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${usable.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index), hit: false });
    out.push({ text: match[0], hit: true });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** "4 long · 4 short" for a flash code, so it can be drawn as blinks. */
export function flashPattern(
  code: string,
): { long: number; short: number } | null {
  const match = /^FLASH:L(\d+)S(\d+)$/.exec(code);
  return match ? { long: Number(match[1]), short: Number(match[2]) } : null;
}

/** A web address to link to, or null: only http(s), never "javascript:". */
export function webUrl(value: string | null | undefined): string | null {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

/** A citation path such as "Raspberry Pi hardware › GPIO boot mode". */
export function trail(path: string[], skipFirst = true): string {
  return (skipFirst ? path.slice(1) : path).join(" › ");
}

/** Where a passage comes from, for a citation line: "boot-gpio.adoc:28". */
export function shortLocation(location: string): string {
  return location;
}
