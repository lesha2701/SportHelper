// frontend/src/components/coaches/ListingEditScreen.tsx
import { useEffect, useState } from "react";
import {
  createListing,
  getListingAvailability,
  replaceListingAvailability,
  updateListing,
  uploadListingPhoto,
  uploadListingVideo,
} from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { Icon } from "../shared/Icon";
import { FilePicker } from "../shared/FilePicker";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import type { AvailabilityWindow, CoachListing } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface WindowDraft {
  weekday: number;
  startTime: string;
  endTime: string;
}

export function ListingEditScreen({
  token,
  listing: initialListing,
  onBack,
}: {
  token: string;
  listing: CoachListing | null;
  onBack: () => void;
}) {
  const isNew = initialListing === null;
  const [listingId, setListingId] = useState<string | null>(initialListing?.id ?? null);
  const [title, setTitle] = useState(initialListing?.title ?? "");
  const [description, setDescription] = useState(initialListing?.description ?? "");
  const [isListed, setIsListed] = useState(initialListing?.isListed ?? false);
  const [price, setPrice] = useState(initialListing?.pricePerSession?.toString() ?? "");
  const [currency, setCurrency] = useState(initialListing?.currency ?? "RUB");
  const [offersOnline, setOffersOnline] = useState(initialListing?.offersOnline ?? false);
  const [offersOffline, setOffersOffline] = useState(initialListing?.offersOffline ?? false);
  const [location, setLocation] = useState(initialListing?.location ?? "");
  const [duration, setDuration] = useState(initialListing?.sessionDurationMinutes?.toString() ?? "60");
  const [photoFileId, setPhotoFileId] = useState<string | null>(initialListing?.photoFileId ?? null);
  const [videoFileId, setVideoFileId] = useState<string | null>(initialListing?.videoFileId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityLoadError, setAvailabilityLoadError] = useState<string | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);

  useEffect(() => {
    if (listingId === null) return;
    getListingAvailability(token, listingId)
      .then((loaded) =>
        setWindows(
          loaded.map((w: AvailabilityWindow) => ({
            weekday: w.weekday,
            startTime: w.startTime.slice(0, 5),
            endTime: w.endTime.slice(0, 5),
          })),
        ),
      )
      .catch((err: unknown) => setAvailabilityLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить расписание"));
    // Only runs once, for the listing this screen was opened with — a
    // brand-new listing has no id yet at mount time (handled by the
    // listingId===null guard above and re-triggered once handleSave sets it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Укажите название объявления.");
      return;
    }
    if (isListed && (!(offersOnline || offersOffline) || !price || !duration)) {
      setError("Укажите цену, формат и длительность тренировки, прежде чем публиковать.");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      is_listed: isListed,
      price_per_session: price ? Number(price) : null,
      currency,
      offers_online: offersOnline,
      offers_offline: offersOffline,
      location: location.trim() || null,
      session_duration_minutes: duration ? Number(duration) : null,
    };
    try {
      if (listingId === null) {
        const wantedListed = isListed;
        // A brand-new listing can never be created already-listed (no
        // availability could exist yet for a not-yet-created row) — the
        // backend rejects this with its own 409 regardless, so create
        // unlisted first and let the coach publish via a follow-up Save
        // once they've added availability below.
        const created = await createListing(token, { ...payload, is_listed: false });
        setListingId(created.id);
        setIsListed(false);
        if (wantedListed) {
          setError("Объявление создано. Добавьте расписание ниже, затем сохраните ещё раз, чтобы опубликовать.");
        }
      } else {
        await updateListing(token, listingId, payload);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "availability_required"
          ? "Сначала задайте расписание — без него нельзя опубликовать объявление."
          : err instanceof ApiError
            ? err.message
            : "Не удалось сохранить объявление",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAvailability = async () => {
    if (listingId === null) {
      setAvailabilityError("Сначала сохраните объявление.");
      return;
    }
    setAvailabilityError(null);
    setSavingAvailability(true);
    try {
      await replaceListingAvailability(
        token,
        listingId,
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

  const handlePhotoChange = async (file: File) => {
    if (listingId === null) {
      setMediaError("Сначала сохраните объявление.");
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    try {
      const updated = await uploadListingPhoto(token, listingId, file);
      setPhotoFileId(updated.photoFileId);
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setMediaBusy(false);
    }
  };

  const handleVideoChange = async (file: File) => {
    if (listingId === null) {
      setMediaError("Сначала сохраните объявление.");
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    try {
      const updated = await uploadListingVideo(token, listingId, file);
      setVideoFileId(updated.videoFileId);
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
    } finally {
      setMediaBusy(false);
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
        <h1 className={profileStyles.pageHeading}>{isNew ? "Новое объявление" : "Редактирование объявления"}</h1>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Название</span>
          <input
            className={profileStyles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Индивидуальные тренировки"
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Показывать в маркетплейсе</span>
            <span className={styles.toggleHint}>Атлеты смогут найти это объявление и записаться</span>
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
          <input className={profileStyles.input} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </label>

        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Формат</span>
          <div className={styles.formatRow}>
            <button type="button" className={offersOnline ? styles.formatChipActive : styles.formatChip} onClick={() => setOffersOnline((v) => !v)}>
              Онлайн
            </button>
            <button type="button" className={offersOffline ? styles.formatChipActive : styles.formatChip} onClick={() => setOffersOffline((v) => !v)}>
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
          <input className={profileStyles.input} type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {listingId !== null && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Фото и видео</h2>
          {mediaError && <p className={profileStyles.error}>{mediaError}</p>}

          {photoFileId && <AuthenticatedImage token={token} fileId={photoFileId} alt={title} className={styles.listingPhoto} />}
          {videoFileId && <AuthenticatedVideo token={token} fileId={videoFileId} className={styles.listingVideo} />}

          <FilePicker
            icon="image"
            label="Выбрать фотографию"
            hint="JPEG, PNG, WEBP или GIF"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onSelect={(file) => void handlePhotoChange(file)}
            disabled={mediaBusy}
          />
          <FilePicker
            icon="video"
            label="Выбрать видео"
            hint="MP4, MOV или WEBM"
            accept="video/mp4,video/quicktime,video/webm"
            onSelect={(file) => void handleVideoChange(file)}
            disabled={mediaBusy}
          />
        </div>
      )}

      {listingId !== null && (
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
                  <button type="button" className={styles.removeRowButton} onClick={() => setWindows(windows.filter((_, j) => j !== i))} aria-label="Удалить">
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
      )}

      {listingId === null && (
        <div className={profileStyles.card}>
          <p className={profileStyles.subtitle}>Сохраните объявление, чтобы добавить фото, видео и расписание.</p>
        </div>
      )}
    </div>
  );
}
