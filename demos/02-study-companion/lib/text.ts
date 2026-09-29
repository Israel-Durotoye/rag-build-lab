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

/** Minutes a section takes to read, at about 200 words a minute. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200));
}

export interface TextWindow {
  /** 1-based position of the window inside its section. */
  piece: number;
  text: string;
  words: number;
}

/**
 * Cut text into windows of `size` words, the way fixed-length chunking does.
 * A last window shorter than `minTail` words joins the window before it.
 * Each window keeps the original spacing and line breaks of the words it
 * holds, so the windows joined together are the text again.
 */
export function fixedWindows(
  text: string,
  size: number,
  minTail = 0,
): TextWindow[] {
  if (size < 1) return [];
  const tokens = text.match(/\s*\S+/g) ?? [];
  const slices: string[][] = [];
  for (let start = 0; start < tokens.length; start += size)
    slices.push(tokens.slice(start, start + size));
  if (slices.length > 1 && slices[slices.length - 1].length < minTail)
    slices[slices.length - 2].push(...slices.pop()!);
  const windows = slices.map((slice, index) => ({
    piece: index + 1,
    text: slice.join(""),
    words: slice.length,
  }));
  if (windows.length) windows[0].text = windows[0].text.trimStart();
  return windows;
}

export interface Marked {
  text: string;
  marked: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find `fragment` inside `text`, ignoring differences in spacing and line
 * breaks, and return the text split into marked and unmarked runs. A fragment
 * that is not found (or is the whole text) yields one unmarked run.
 */
export function markFragment(text: string, fragment: string): Marked[] {
  const words = fragment.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [{ text, marked: false }];
  const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"));
  const match = pattern.exec(text);
  if (!match || match[0].length >= text.trim().length)
    return [{ text, marked: false }];
  const end = match.index + match[0].length;
  return [
    { text: text.slice(0, match.index), marked: false },
    { text: match[0], marked: true },
    { text: text.slice(end), marked: false },
  ].filter((run) => run.text.length > 0);
}

/** "controls:feedback" → the section part, for matching expected sections. */
export function sectionOf(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}
