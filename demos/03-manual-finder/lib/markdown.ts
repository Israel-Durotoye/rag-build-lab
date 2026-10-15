/**
 * A small Markdown subset for model answers: paragraphs, headings, bullet
 * and numbered lists, **bold**, *italic*, `code` and citation markers [n].
 * It produces plain data (rendered by components/markdown.tsx), never HTML.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "cite"; n: number };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const INLINE =
  /(\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|`([^`]+)`|\[(\d{1,2})\])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: text.slice(last, index) });
    if (match[2] ?? match[3])
      out.push({ type: "strong", children: parseInline(match[2] ?? match[3]) });
    else if (match[4])
      out.push({ type: "em", children: parseInline(match[4]) });
    else if (match[5]) out.push({ type: "code", text: match[5] });
    else out.push({ type: "cite", n: Number(match[6]) });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length)
      blocks.push({
        type: "paragraph",
        children: parseInline(paragraph.join(" ")),
      });
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      blocks.push({
        type: "list",
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((item) => parseInline(item)),
      });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const heading = HEADING.exec(line);
    if (!line.trim()) {
      // A blank line ends a paragraph. A list goes on if another item
      // follows ("1. A", blank, "2. B" is one list).
      flushParagraph();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", children: parseInline(heading[1]) });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      // A numbered list that resumes after a paragraph keeps its numbers.
      list ??= {
        ordered,
        start: numbered ? Number(numbered[1]) : 1,
        items: [],
      };
      list.items.push(bullet ? bullet[1] : numbered![2]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented continuation line belongs to the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
