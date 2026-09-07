// frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx
import { useEffect, useState } from "react";
import { getMyMarketplaceSettings, updateMyMarketplaceSettings, getMyAvailability, replaceMyAvailability } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachMarketplaceSettings, AvailabilityWindow } from "../../types/coach";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: CoachMarketplaceSettings };

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface WindowDraft {
  weekday: number;
  startTime: string;
  endTime: string;
}

export function CoachMarketplaceSettingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isListed, setIsListed] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [offersOnline, setOffersOnline] = useState(false);
  const [offersOffline, setOffersOffline] = useState(false);
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityLoadError, setAvailabilityLoadError] = useState<string | null>(null);

  useEffect(() => {
    getMyAvailability(token)
      .then((loaded) =>
        setWindows(
          loaded.map((w: AvailabilityWindow) => ({
            weekday: w.weekday,
            startTime: w.startTime.slice(0, 5),
            endTime: w.endTime.slice(0, 5),
          })),
        ),
      )
      .catch((err: unknown) => {
        setAvailabilityLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить расписание");
      });
  }, [token]);

  useEffect(() => {
    getMyMarketplaceSettings(token)
      .then((settings) => {
        setState({ status: "ready", settings });
        setIsListed(settings.isListed);
        setPrice(settings.pricePerSession?.toString() ?? "");
        setCurrency(settings.currency);
        setOffersOnline(settings.offersOnline);
        setOffersOffline(settings.offersOffline);
        setLocation(settings.location ?? "");
        setDuration(settings.sessionDurationMinutes?.toString() ?? "60");
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить настройки";
        setState({ status: "error", message });
      });
  }, [token]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка настроек…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить настройки" description={state.message} />;
  }

  const handleSave = async () => {
    setError(null);
    if (isListed && (!(offersOnline || offersOffline) || !price || !duration)) {
      setError("Укажите цену, формат и длительность тренировки, прежде чем включать листинг.");
      return;
    }
    setSaving(true);
    try {
      const settings = await updateMyMarketplaceSettings(token, {
        is_listed: isListed,
        price_per_session: price ? Number(price) : null,
        currency,
        offers_online: offersOnline,
        offers_offline: offersOffline,
        location: location.trim() || null,
        session_duration_minutes: duration ? Number(duration) : null,
      });
      setState({ status: "ready", settings });
    } catch (err) {
      if (err instanceof ApiError && err.code === "availability_required") {
        setError("Сначала задайте недельное расписание — без него нельзя включить листинг.");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить настройки");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAvailability = async () => {
    setAvailabilityError(null);
    setSavingAvailability(true);
    try {
      await replaceMyAvailability(
        token,
        windows.map((w) => ({ weekday: w.weekday, start_time: `${w.startTime}:00`, end_time: `${w.endTime}:00` })),
      );
    } catch (err) {
      setAvailabilityError(
        err instanceof ApiError && err.code === "overlapping_availability"
          ? "Окна пересекаются — поправьте время."
          : err instanceof ApiError
            ? err.message
            : "Не удалось сохранить расписание",
      );
    } finally {
      setSavingAvailability(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Маркетплейс тренеров</h1>

        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Показывать меня в маркетплейсе</span>
            <span className={styles.toggleHint}>Атлеты смогут найти вас и записаться на тренировку</span>
          </div>
          <button
            type="button"
            className={isListed ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            onClick={() => setIsListed((v) => !v)}
            role="switch"
            aria-checked={isListed}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Цена за тренировку</span>
          <input
            className={profileStyles.input}
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="2000"
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Валюта</span>
          <input
            className={profileStyles.input}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>

        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Формат</span>
          <div className={styles.formatRow}>
            <button
              type="button"
              className={offersOnline ? styles.formatChipActive : styles.formatChip}
              onClick={() => setOffersOnline((v) => !v)}
            >
              Онлайн
            </button>
            <button
              type="button"
              className={offersOffline ? styles.formatChipActive : styles.formatChip}
              onClick={() => setOffersOffline((v) => !v)}
            >
              Очно
            </button>
          </div>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Город (для очных тренировок)</span>
          <input className={profileStyles.input} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Длительность тренировки, мин</span>
          <input
            className={profileStyles.input}
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Недельное расписание</h2>
        <p className={profileStyles.subtitle}>Когда вы обычно свободны — из этого система нарежет слоты для записи.</p>

        {availabilityLoadError ? (
          <p className={profileStyles.error}>
            Не удалось загрузить текущее расписание: {availabilityLoadError}. Сохранение отключено, чтобы случайно не стереть
            существующие окна — обновите страницу и попробуйте снова.
          </p>
        ) : (
          <>
            {windows.map((w, i) => (
              <div className={styles.weekdayRow} key={i}>
                <select
                  className={styles.weekdaySelect}
                  value={w.weekday}
                  onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}
                >
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <option key={idx} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.timeInput}
                  type="time"
                  value={w.startTime}
                  onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
                />
                <span>—</span>
                <input
                  className={styles.timeInput}
                  type="time"
                  value={w.endTime}
                  onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
                />
                <button
                  type="button"
                  className={styles.removeRowButton}
                  onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                  aria-label="Удалить"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}

            <button
              type="button"
              className={profileStyles.buttonSecondary}
              onClick={() => setWindows([...windows, { weekday: 0, startTime: "10:00", endTime: "12:00" }])}
            >
              <Icon name="plus" size={16} />
              Добавить окно
            </button>

            {availabilityError && <p className={profileStyles.error}>{availabilityError}</p>}
          </>
        )}

        <div className={profileStyles.formActions}>
          <button
            type="button"
            className={profileStyles.buttonPrimary}
            onClick={() => void handleSaveAvailability()}
            disabled={savingAvailability || !!availabilityLoadError}
          >
            {savingAvailability ? "Сохранение…" : "Сохранить расписание"}
          </button>
        </div>
      </div>
    </div>
  );
}
