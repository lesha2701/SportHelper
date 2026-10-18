import { useEffect, useState } from "react";
import { loadDocument } from "../../legal/load";
import type { LegalDocumentMeta } from "../../legal/documents";
import type { LegalDocumentData } from "../../legal/types";
import { StateScreen } from "../StateScreen";
import { PublicShell } from "../public/PublicShell";
import styles from "../public/public.module.css";
import { LegalBlocks } from "./LegalDocument";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: LegalDocumentData };

/** One legal document on its own public page (the sign-up check boxes and the footer link here). */
export function LegalDocumentPage({ meta }: { meta: LegalDocumentMeta }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loadDocument(meta.key)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [meta.key, attempt]);

  useEffect(() => {
    document.title = `${meta.label} — SportArenaGlobal`;
  }, [meta.label]);

  return (
    <PublicShell>
      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка документа…" />}
      {state.status === "error" && (
        <StateScreen kind="error" title="Не удалось загрузить документ" onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {state.status === "ready" && (
        <article className={styles.legal}>
          <LegalBlocks blocks={state.data.blocks} />
        </article>
      )}
    </PublicShell>
  );
}
