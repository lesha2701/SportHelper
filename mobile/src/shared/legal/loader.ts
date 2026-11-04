import type { DocumentKey } from "./documents";
import type { LegalDocumentData } from "./types";

/** The texts ship inside the app, so they read offline and are exactly the editions the sign-up reports as accepted. */
const DATA: Record<DocumentKey, LegalDocumentData> = {
  terms: require("./data/terms.json"),
  "coach-offer": require("./data/coach-offer.json"),
  "service-terms": require("./data/service-terms.json"),
  privacy: require("./data/privacy.json"),
  "consent-player": require("./data/consent-player.json"),
  "consent-coach": require("./data/consent-coach.json"),
  "consent-coach-dissemination": require("./data/consent-coach-dissemination.json"),
};

export function loadDocument(key: DocumentKey): LegalDocumentData {
  return DATA[key];
}
