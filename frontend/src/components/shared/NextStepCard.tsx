import type { ReactNode } from "react";
import { Icon } from "./Icon";
import profileStyles from "../profile/profile.module.css";
import styles from "./nextStep.module.css";

export interface NextStepAction {
  label: string;
  onClick: () => void;
}

/** In-place success state: what just happened, plus the one obvious next step
 * (primary) and at most one way back to the related list (secondary). */
export function NextStepCard({
  title,
  message,
  primary,
  secondary,
}: {
  title: string;
  message?: ReactNode;
  primary?: NextStepAction;
  secondary?: NextStepAction;
}) {
  return (
    <div className={`${profileStyles.card} ${styles.card}`} role="status">
      <div className={styles.head}>
        <span className={styles.check}>
          <Icon name="check-circle" size={20} />
        </span>
        <h2 className={styles.title}>{title}</h2>
      </div>
      {message && <p className={profileStyles.subtitle}>{message}</p>}
      {(primary || secondary) && (
        <div className={styles.actions}>
          {primary && (
            <button type="button" className={profileStyles.buttonPrimary} onClick={primary.onClick}>
              {primary.label}
            </button>
          )}
          {secondary && (
            <button type="button" className={styles.secondary} onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
