import { Icon, type IconName } from "../shared/Icon";
import styles from "./blog.module.css";

/** A small counter with an icon: likes, comments, views. The label is read out instead of the picture. */
export function Stat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  return (
    <span className={styles.stat} title={label} aria-label={`${label}: ${value}`}>
      <Icon name={icon} size={14} />
      {value}
    </span>
  );
}
