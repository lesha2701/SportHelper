import { Icon } from "./Icon";
import styles from "./ProBadge.module.css";

/** The mark next to the name of a trainer with the Pro status (set by an administrator). */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span className={className ? `${styles.badge} ${className}` : styles.badge} title="Тренер Pro">
      <Icon name="crown" size={12} strokeWidth={2.2} />
      PRO
    </span>
  );
}
