import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type ToastItem } from "../../toast";
import { Icon } from "./Icon";
import styles from "./ToastHost.module.css";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className={styles.host} aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={item.kind === "error" ? `${styles.toast} ${styles.error}` : `${styles.toast} ${styles.success}`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          <span className={styles.icon}>
            <Icon name={item.kind === "error" ? "alert-triangle" : "check-circle"} size={18} />
          </span>
          <span className={styles.message}>{item.message}</span>
          <button type="button" className={styles.close} onClick={() => dismissToast(item.id)} aria-label="Закрыть">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
