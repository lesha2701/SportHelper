import type { ReactElement } from "react";
import { EmptyIllustration, ErrorIllustration, ForbiddenIllustration } from "./shared/illustrations";
import styles from "./StateScreen.module.css";

export type StateKind = "loading" | "error" | "empty" | "forbidden";

interface StateScreenProps {
  kind: StateKind;
  title: string;
  description?: string;
  onRetry?: () => void;
}

const ILLUSTRATIONS: Record<Exclude<StateKind, "loading">, () => ReactElement> = {
  error: ErrorIllustration,
  empty: EmptyIllustration,
  forbidden: ForbiddenIllustration,
};

export function StateScreen({ kind, title, description, onRetry }: StateScreenProps) {
  return (
    <div className={styles.wrapper} role="status">
      {kind === "loading" ? (
        <div className={styles.skeletonGroup} aria-hidden="true">
          <div className={styles.skeletonLine} style={{ width: "60%" }} />
          <div className={styles.skeletonLine} style={{ width: "90%" }} />
          <div className={styles.skeletonLine} style={{ width: "75%" }} />
        </div>
      ) : (
        <div className={kind === "error" ? `${styles.iconBadge} ${styles.iconBadgeDanger}` : styles.iconBadge}>
          {ILLUSTRATIONS[kind]()}
        </div>
      )}

      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}

      {onRetry && (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
