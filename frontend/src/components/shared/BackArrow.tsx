import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./BackArrow.module.css";

/** Just an arrow: goes one step back (to the screen the person came from). Sits on the heading's line, to the left of the title. */
export function BackArrow({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.arrow} onClick={onClick} disabled={disabled} aria-label="Назад" title="Назад">
      <Icon name="arrow-left" size={20} />
    </button>
  );
}

/** A screen's title with the arrow to its left, on one line. Without `onBack` it is just the title. */
export function TitleWithBack({ onBack, disabled, children }: { onBack?: () => void; disabled?: boolean; children: ReactNode }) {
  if (!onBack) return <>{children}</>;
  return (
    <div className={styles.titleRow}>
      <BackArrow onClick={onBack} disabled={disabled} />
      {children}
    </div>
  );
}
