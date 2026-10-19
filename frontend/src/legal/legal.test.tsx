import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegalBlocks } from "../components/legal/LegalDocument";
import { CONSENTS_BY_ROLE, DOCUMENT_LIST, DOCUMENTS } from "./documents";
import { loadDocument } from "./load";
import type { Block } from "./types";

afterEach(cleanup);

describe("the documents", () => {
  it.each(DOCUMENT_LIST.map((doc) => [doc.key] as const))("%s: the published text matches the registry (title and edition)", async (key) => {
    const data = await loadDocument(key);

    expect(data.key).toBe(key);
    expect(data.title).toBe(DOCUMENTS[key].title);
    expect(data.version).toBe(DOCUMENTS[key].version);
    expect(data.blocks.length).toBeGreaterThan(5);
    expect(JSON.stringify(data.blocks)).toContain(`Редакция от ${data.version.split("-").reverse().join(".")}`);
    expect(JSON.stringify(data.blocks)).toContain("Дата размещения: 18.10.2026 года");
  });

  it("every box points only at documents that exist, and every document is reachable from a box or the policy", () => {
    const used = new Set<string>(["privacy"]);
    for (const consents of Object.values(CONSENTS_BY_ROLE)) {
      for (const consent of consents) {
        for (const doc of consent.documents) {
          expect(DOCUMENTS[doc]).toBeTruthy();
          used.add(doc);
        }
      }
    }
    expect([...used].sort()).toEqual(DOCUMENT_LIST.map((doc) => doc.key).sort());
  });

  it("names ЮKassa, not Альфа-Банк, as the payment service where cards are entered", async () => {
    const all = JSON.stringify(await Promise.all(DOCUMENT_LIST.map((doc) => loadDocument(doc.key))));

    expect(all).not.toContain("Альфа");
    expect(all).not.toContain("или иного платёжного сервиса");
    expect(all).toContain("странице сервиса ЮKassa");
    expect(all).toContain("я ввожу на странице платёжного сервиса ЮKassa");
    expect(all).not.toContain("персональнысх");
  });

  it("each document has a distinct address", () => {
    const paths = DOCUMENT_LIST.map((doc) => doc.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("rendering a document", () => {
  const blocks: Block[] = [
    { type: "h1", runs: [{ t: "Заголовок" }] },
    { type: "p", runs: [{ t: "Пишите на " }, { t: "help@example.com", b: true }, { t: " или на https://example.com/page." }] },
    { type: "p", runs: [{ t: "<script>alert(1)</script> <b>не разметка</b>" }] },
    { type: "p", runs: [{ t: "опасная", href: "javascript:alert(1)" }, { t: " и обычная ", i: true }, { t: "ссылка", href: "https://example.com" }] },
    { type: "ol", items: [[{ t: "первый" }], [{ t: "второй" }]] },
    { type: "table", rows: [[[[{ t: "Мера", b: true }]], [[{ t: "Основание", b: true }]]], [[[{ t: "Штраф" }]], [[{ t: "п. 8.4" }]]]] },
  ];

  it("shows text, lists and tables", () => {
    render(<LegalBlocks blocks={blocks} />);

    expect(screen.getByRole("heading", { level: 1, name: "Заголовок" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Мера" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "п. 8.4" })).toBeTruthy();
  });

  it("makes addresses clickable", () => {
    render(<LegalBlocks blocks={blocks} />);

    expect(screen.getByRole("link", { name: "help@example.com" }).getAttribute("href")).toBe("mailto:help@example.com");
    expect(screen.getByRole("link", { name: "https://example.com/page" }).getAttribute("href")).toBe("https://example.com/page");
  });

  it("never turns document text into markup or a script link", () => {
    const { container } = render(<LegalBlocks blocks={blocks} />);

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByText("опасная")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ссылка" }).getAttribute("rel")).toContain("noopener");
  });
});
