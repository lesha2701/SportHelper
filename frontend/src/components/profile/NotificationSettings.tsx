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
        <label key={preference.category} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <input
            type="checkbox"
            checked={preference.enabled}
            disabled={busyCategory === preference.category}
            onChange={() => void toggle(preference)}
          />
          <span>{NOTIFICATION_CATEGORY_LABELS[preference.category]}</span>
        </label>
      ))}
    </div>
  );
}
