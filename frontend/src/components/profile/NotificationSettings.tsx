import { useEffect, useState } from "react";
import { getNotificationPreferences, setNotificationPreference } from "../../api/notifications";
import { ApiError } from "../../api/client";
import { NOTIFICATION_CATEGORY_LABELS, type NotificationPreference } from "../../types/notification";
import styles from "./profile.module.css";

export function NotificationSettings({ token }: { token: string }) {
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCategory, setBusyCategory] = useState<string | null>(null);

  useEffect(() => {
    getNotificationPreferences(token)
      .then(setPreferences)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить настройки"));
  }, [token]);

  if (preferences === null) {
    return null;
  }

  const toggle = async (preference: NotificationPreference) => {
    setBusyCategory(preference.category);
    setError(null);
    try {
      const updated = await setNotificationPreference(token, { category: preference.category, enabled: !preference.enabled });
      setPreferences(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить настройку");
    } finally {
      setBusyCategory(null);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Уведомления</h2>
      {error && <p className={styles.error}>{error}</p>}
      {preferences.map((preference) => (
        <div className={styles.toggleRow} key={preference.category}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>{NOTIFICATION_CATEGORY_LABELS[preference.category]}</span>
          </div>
          <button
            type="button"
            className={preference.enabled ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            role="switch"
            aria-checked={preference.enabled}
            disabled={busyCategory === preference.category}
            onClick={() => void toggle(preference)}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
      ))}
    </div>
  );
}
