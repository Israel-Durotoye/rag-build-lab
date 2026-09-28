import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

function inline(nodes: Inline[], onCite?: (n: number) => void): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return <strong key={index}>{inline(node.children, onCite)}</strong>;
      case "em":
        return <em key={index}>{inline(node.children, onCite)}</em>;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "cite":
        return (
          <button
            key={index}
            type="button"
            className="cite"
            onClick={() => onCite?.(node.n)}
            aria-label={`Show source ${node.n}`}
          >
            {node.n}
          </button>
        );
    }
  });
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
