import type { Role } from "../types/user";

/** The legal documents shown on the site. The text lives in ./data/<key>.json (generated from the signed-off .docx files by
 * scripts/legal_docx_to_json.py); the versions below are what the sign-up form reports as "accepted", and the server only
 * records an acceptance whose version matches its own list (backend/app/services/legal.py). A test keeps all three in step. */

export type DocumentKey =
  | "terms"
  | "coach-offer"
  | "service-terms"
  | "privacy"
  | "consent-player"
  | "consent-coach"
  | "consent-coach-dissemination";

export interface LegalDocumentMeta {
  key: DocumentKey;
  /** Where the document is published (the site root + this path). */
  path: string;
  title: string;
  /** Short name for links and the footer. */
  label: string;
  /** The edition, YYYY-MM-DD. */
  version: string;
}

export const DOCUMENTS: Record<DocumentKey, LegalDocumentMeta> = {
  terms: {
    key: "terms",
    path: "/terms",
    title: "Пользовательское соглашение (публичная оферта) для спортсменов",
    label: "Пользовательское соглашение",
    version: "2026-10-20",
  },
  "coach-offer": {
    key: "coach-offer",
    path: "/coach-offer",
    title: "Оферта для тренеров (договор оказания услуг и агентский договор)",
    label: "Оферта для тренеров",
    version: "2026-10-20",
  },
  "service-terms": {
    key: "service-terms",
    path: "/service-terms",
    title: "Типовые условия оказания услуг тренером",
    label: "Типовые условия оказания услуг тренером",
    version: "2026-10-20",
  },
  privacy: {
    key: "privacy",
    path: "/privacy",
    title: "Политика обработки персональных данных",
    label: "Политика обработки персональных данных",
    version: "2026-10-20",
  },
  "consent-player": {
    key: "consent-player",
    path: "/consent-player",
    title: "Согласие спортсмена на обработку персональных данных",
    label: "Согласие спортсмена на обработку ПДн",
    version: "2026-10-20",
  },
  "consent-coach": {
    key: "consent-coach",
    path: "/consent-coach",
    title: "Согласие тренера на обработку персональных данных",
    label: "Согласие тренера на обработку ПДн",
    version: "2026-10-20",
  },
  "consent-coach-dissemination": {
    key: "consent-coach-dissemination",
    path: "/consent-coach-dissemination",
    title: "Согласие тренера на обработку персональных данных, разрешённых для распространения",
    label: "Согласие тренера на распространение ПДн",
    version: "2026-10-20",
  },
};

export const DOCUMENT_LIST: LegalDocumentMeta[] = Object.values(DOCUMENTS);

export function documentByPath(path: string): LegalDocumentMeta | null {
  return DOCUMENT_LIST.find((doc) => doc.path === path) ?? null;
}

// --- the check boxes of the sign-up form -------------------------------------------------------------------------------

export type ConsentKey = "terms" | "coach_offer" | "personal_data" | "data_dissemination";

/** One check box. `documents` are the documents it refers to (all of them are recorded, with their editions, when it is ticked). */
export interface ConsentDef {
  key: ConsentKey;
  documents: DocumentKey[];
}

/** Exactly the boxes the scheme gives each role, in the order they are shown. None is ticked in advance. */
export const CONSENTS_BY_ROLE: Record<Role, ConsentDef[]> = {
  player: [
    { key: "terms", documents: ["terms"] },
    { key: "personal_data", documents: ["consent-player", "privacy"] },
  ],
  coach: [
    { key: "coach_offer", documents: ["coach-offer", "service-terms"] },
    { key: "personal_data", documents: ["consent-coach", "privacy"] },
    { key: "data_dissemination", documents: ["consent-coach-dissemination"] },
  ],
};
