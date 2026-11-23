import { Fragment, type ReactNode } from "react";
import type { PostBlock } from "../../api/blog";
import styles from "./blog.module.css";

/** Turns the article's markers into React nodes: **bold** and *italic*, nothing else. It never builds HTML, so
 * whatever an author types is shown as plain text (a "<script>" is just those characters). An unpaired marker stays as typed. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    nodes.push(match[1] !== undefined ? <strong key={key++}>{match[1]}</strong> : <em key={key++}>{match[2]}</em>);
    last = at + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** The text with the markers removed: what its length is counted by. */
export const plainText = (text: string): string => text.replace(/\*{1,2}/g, "");

export function blocksLength(blocks: PostBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.type === "list") total += (block.items ?? []).reduce((sum, item) => sum + plainText(item).length, 0);
    else total += plainText(block.text ?? "").length;
  }
  return total;
}

/** Lines of text with line breaks kept inside a paragraph. */
function lines(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ));
}

export function PostBody({ blocks }: { blocks: PostBlock[] }) {
  return (
    <div className={styles.body}>
      {blocks.map((block, i) => {
        if (block.type === "heading") return <h2 key={i}>{renderInline(block.text ?? "")}</h2>;
        if (block.type === "quote") return <blockquote key={i}>{lines(block.text ?? "")}</blockquote>;
        if (block.type === "list")
          return (
            <ul key={i}>
              {(block.items ?? []).map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{lines(block.text ?? "")}</p>;
      })}
    </div>
  );
}

/** Wraps the selected part of a field in a marker (or, with nothing selected, puts a pair of markers and the cursor between them). */
export function wrapSelection(value: string, start: number, end: number, marker: string): { value: string; start: number; end: number } {
  const before = value.slice(0, start);
  const chosen = value.slice(start, end);
  const after = value.slice(end);
  if (chosen.startsWith(marker) && chosen.endsWith(marker) && chosen.length >= marker.length * 2) {
    const inner = chosen.slice(marker.length, chosen.length - marker.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  return { value: before + marker + chosen + marker + after, start: start + marker.length, end: end + marker.length };
}

export function formatPostDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
