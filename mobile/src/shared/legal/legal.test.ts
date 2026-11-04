import { describe, expect, it } from "@jest/globals";
import { CONSENTS_BY_ROLE, DOCUMENT_LIST, DOCUMENTS } from "./documents";
import { loadDocument } from "./loader";

describe("bundled legal documents", () => {
  it("ship the same edition the sign-up reports as accepted", () => {
    for (const meta of DOCUMENT_LIST) {
      const doc = loadDocument(meta.key);
      expect(doc.key).toBe(meta.key);
      expect(doc.version).toBe(meta.version);
      expect(doc.blocks.length).toBeGreaterThan(0);
    }
  });

  it("cover every document that a role's check boxes refer to", () => {
    for (const consents of Object.values(CONSENTS_BY_ROLE)) {
      for (const consent of consents) {
        for (const key of consent.documents) expect(DOCUMENTS[key]).toBeDefined();
      }
    }
  });
});
