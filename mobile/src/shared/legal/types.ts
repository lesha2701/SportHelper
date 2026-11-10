/** The shape of ./data/<key>.json: plain text runs, never HTML. */
export interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  href?: string;
}

export type Block =
  | { type: "h1" | "h2"; runs: Run[]; center?: boolean }
  | { type: "p"; runs: Run[]; align?: "center" }
  | { type: "ul" | "ol"; items: Run[][] }
  | { type: "table"; rows: Run[][][][] };

export interface LegalDocumentData {
  key: string;
  title: string;
  version: string;
  blocks: Block[];
}
