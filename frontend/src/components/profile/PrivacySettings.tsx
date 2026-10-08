import { useEffect, useState } from "react";
import { getPrivacySettings, setAiAnalysisConsent } from "../../api/privacy";
import { ApiError } from "../../api/client";
import styles from "./profile.module.css";

export function PrivacySettings({ token }: { token: string }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPrivacySettings(token)
      .then((settings) => setAllowed(settings.allowAiAnalysisByPersonalCoach))
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить настройки"));
  }, [token]);

  const toggle = async () => {
    if (allowed === null || busy) return;
    setBusy(true);
    try {
      const updated = await setAiAnalysisConsent(token, !allowed);
      setAllowed(updated.allowAiAnalysisByPersonalCoach);
    } catch {
      // the API layer already showed why it failed; the switch simply stays where it was
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Конфиденциальность</h2>
      {loadError && <p className={styles.error}>{loadError}</p>}
      {!loadError && (
        <>
          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <span className={styles.toggleTitle}>AI-анализ для личных тренеров</span>
              <span className={styles.toggleHint}>
                Разрешить тренерам, у которых с вами есть подтверждённая личная тренировка, использовать ваши спортивные данные
                для AI-анализа и подготовки к занятию.
              </span>
            </div>
            <button
              type="button"
              className={allowed ? `${styles.switch} ${styles.switchOn}` : styles.switch}
              role="switch"
              aria-checked={allowed === true}
              aria-label="AI-анализ для личных тренеров"
              disabled={allowed === null || busy}
              onClick={() => void toggle()}
            >
              <span className={styles.switchKnob} />
            </button>
          </div>
          <p className={styles.subtitle}>
            Для анализа могут использоваться ваша статистика, история тренировок, посещаемость, спортивные показатели, задания и
            отчёты. Фото и видео из отчётов тренеру при этом не открываются. По умолчанию доступ выключен; если вы отключите его,
            уже подготовленные анализы будут удалены.
          </p>
        </>
      )}
    </div>
  );
}
