import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

const TRAILING = /^[.,;:!?)\]]+/;

function Cite({ n, onCite }: { n: number; onCite?: (n: number) => void }) {
  return (
    <button
      type="button"
      className="cite"
      onClick={() => onCite?.(n)}
      aria-label={`Show source ${n}`}
    >
      {n}
    </button>
  );
}

function inline(nodes: Inline[], onCite?: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  // Punctuation already shown beside the citation before it.
  let taken = "";
  nodes.forEach((node, index) => {
    switch (node.type) {
      case "text": {
        out.push(
          <Fragment key={index}>{node.text.slice(taken.length)}</Fragment>,
        );
        taken = "";
        break;
      }
      case "strong":
        out.push(<strong key={index}>{inline(node.children, onCite)}</strong>);
        break;
      case "em":
        out.push(<em key={index}>{inline(node.children, onCite)}</em>);
        break;
      case "code":
        out.push(<code key={index}>{node.text}</code>);
        break;
      case "cite": {
        // A browser may break the line between a citation and the full stop
        // after it, leaving the full stop alone on the next line.
        const next = nodes[index + 1];
        taken =
          next?.type === "text" ? (TRAILING.exec(next.text)?.[0] ?? "") : "";
        out.push(
          taken ? (
            <span key={index} className="nowrap">
              <Cite n={node.n} onCite={onCite} />
              {taken}
            </span>
          ) : (
            <Cite key={index} n={node.n} onCite={onCite} />
          ),
        );
        break;
      }
    }
  });
  return out;
}

export function Markdown({
  text,
  onCite,
}: {
  text: string;
  onCite?: (n: number) => void;
}) {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading")
          return <h4 key={index}>{inline(block.children, onCite)}</h4>;
        if (block.type === "paragraph")
          return <p key={index}>{inline(block.children, onCite)}</p>;
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item, onCite)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
