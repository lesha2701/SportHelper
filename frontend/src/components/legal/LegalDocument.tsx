import { Fragment, type ReactNode } from "react";
import type { Block, Run } from "../../legal/types";

const AUTOLINK = /([^\s@<>()«»]+@[^\s@<>()«»]+\.[A-Za-zА-Яа-я]{2,}|https?:\/\/[^\s<>()«»]+)/g;

/** Plain text, with e-mail addresses and web addresses made clickable. The document text is never treated as HTML. */
function linkify(text: string): ReactNode[] {
  return text.split(AUTOLINK).map((part, index) => {
    if (index % 2 === 0) return part;
    const trimmed = part.replace(/[.,;:]+$/, "");
    const rest = part.slice(trimmed.length);
    const web = trimmed.startsWith("http");
    return (
      <Fragment key={index}>
        <a href={web ? trimmed : `mailto:${trimmed}`} rel="noopener noreferrer" target={web ? "_blank" : undefined}>
          {trimmed}
        </a>
        {rest}
      </Fragment>
    );
  });
}

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) => {
        const href = run.href ? safeHref(run.href) : null;
        let node: ReactNode = href ? (
          <a href={href} rel="noopener noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>
            {run.t}
          </a>
        ) : (
          linkify(run.t)
        );
        if (run.b) node = <strong>{node}</strong>;
        if (run.i) node = <em>{node}</em>;
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
  );
}

function Cell({ paragraphs }: { paragraphs: Run[][] }) {
  return (
    <>
      {paragraphs.map((runs, index) => (
        <Fragment key={index}>
          <Runs runs={runs} />
          {index < paragraphs.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </>
  );
}

export function LegalBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h1":
            return (
              <h1 key={index}>
                <Runs runs={block.runs} />
              </h1>
            );
          case "h2":
            return (
              <h2 key={index}>
                <Runs runs={block.runs} />
              </h2>
            );
          case "p":
            return (
              <p key={index} style={block.align === "center" ? { textAlign: "center" } : undefined}>
                <Runs runs={block.runs} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Runs runs={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={index} className="legalTableWrap">
                <table>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          r === 0 ? (
                            <th key={c}>
                              <Cell paragraphs={cell} />
                            </th>
                          ) : (
                            <td key={c}>
                              <Cell paragraphs={cell} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
