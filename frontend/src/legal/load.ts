import type { DocumentKey } from "./documents";
import type { LegalDocumentData } from "./types";

/** Each document is its own chunk: it is only downloaded by someone who opens it. */
const LOADERS: Record<DocumentKey, () => Promise<unknown>> = {
  terms: () => import("./data/terms.json"),
  "coach-offer": () => import("./data/coach-offer.json"),
  "service-terms": () => import("./data/service-terms.json"),
  privacy: () => import("./data/privacy.json"),
  "consent-player": () => import("./data/consent-player.json"),
  "consent-coach": () => import("./data/consent-coach.json"),
  "consent-coach-dissemination": () => import("./data/consent-coach-dissemination.json"),
};

export async function loadDocument(key: DocumentKey): Promise<LegalDocumentData> {
  const module = (await LOADERS[key]()) as { default: unknown };
  return module.default as LegalDocumentData;
}
