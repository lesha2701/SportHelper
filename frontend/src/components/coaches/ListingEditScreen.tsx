// frontend/src/components/coaches/ListingEditScreen.tsx
import { useEffect, useMemo, useState } from "react";
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
import { photoVideoGallery } from "../shared/MediaLightbox";
import { toast, withoutSuccessToasts } from "../../toast";
import { FilePicker } from "../shared/FilePicker";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import type { AvailabilityWindow, CoachListing } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

interface WindowDraft {
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Client-side pre-check of a picked video (the server enforces the same
 * limits) so a too-big/too-long file is rejected before the long upload. */
function checkVideo(file: File): Promise<string | null> {
  if (file.size > MAX_VIDEO_BYTES) return Promise.resolve("Видео больше 100 МБ.");
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (result: string | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    probe.preload = "metadata";
    probe.onloadedmetadata = () =>
      done(probe.duration > MAX_VIDEO_SECONDS + 0.5 ? "Видео должно быть короче 1 минуты." : null);
    // Some containers can't be probed in the browser; the server still checks.
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

function usePreviewUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
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
  // Set once the row exists server-side. If a multi-step save fails halfway
  // for a new listing, a retry continues as an update instead of creating a duplicate.
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
  // Newly picked files, uploaded together with everything else on Save.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const photoPreview = usePreviewUrl(pendingPhoto);
  const videoPreview = usePreviewUrl(pendingVideo);
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  // Existing listings load their schedule first; saving without it would wipe it.
  const [availabilityReady, setAvailabilityReady] = useState(isNew);
  const [availabilityLoadError, setAvailabilityLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialListing === null) return;
    getListingAvailability(token, initialListing.id)
      .then((loaded) => {
        setWindows(
          loaded.map((w: AvailabilityWindow) => ({
            weekday: w.weekday,
            startTime: w.startTime.slice(0, 5),
            endTime: w.endTime.slice(0, 5),
          })),
        );
        setAvailabilityReady(true);
      })
      .catch((err: unknown) => setAvailabilityLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить расписание"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (message: string) => {
    setError(message);
    toast.error(message);
  };

  const pickPhoto = (file: File) => {
    setError(null);
    setPendingPhoto(file);
  };

  const pickVideo = async (file: File) => {
    setError(null);
    const problem = await checkVideo(file);
    if (problem) {
      fail(problem);
      return;
    }
    setPendingVideo(file);
  };

  const validate = (): string | null => {
    if (!title.trim()) return "Укажите название объявления.";
    for (const w of windows) {
      if (!w.startTime || !w.endTime || w.startTime >= w.endTime) {
        return "В расписании время окончания должно быть позже времени начала.";
      }
    }
    if (isListed) {
      if (!(offersOnline || offersOffline)) return "Выберите формат тренировки (онлайн или очно), чтобы опубликовать объявление.";
      if (!price) return "Укажите цену, чтобы опубликовать объявление.";
      if (!duration) return "Укажите длительность тренировки, чтобы опубликовать объявление.";
      if (windows.length === 0) return "Добавьте хотя бы одно окно в расписание — без него нельзя опубликовать объявление.";
    }
    return null;
  };

  const handleSave = async () => {
    setError(null);
    const problem = validate();
    if (problem) {
      fail(problem);
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
    const availabilityPayload = windows.map((w) => ({
      weekday: w.weekday,
      start_time: `${w.startTime}:00`,
      end_time: `${w.endTime}:00`,
    }));

    const wasNew = listingId === null;
    let step = "объявление";
    try {
      await withoutSuccessToasts(async () => {
        let id = listingId;
        if (id === null) {
          // The backend refuses to create a listing already published (no
          // schedule can exist for a row that isn't there yet): create it
          // hidden, attach schedule + media, then publish as the last step.
          const created = await createListing(token, { ...payload, is_listed: false });
          id = created.id;
          setListingId(id);
        }

        if (availabilityReady && !(wasNew && windows.length === 0)) {
          step = "расписание";
          await replaceListingAvailability(token, id, availabilityPayload);
        }
        if (!wasNew) {
          step = "объявление";
          await updateListing(token, id, payload);
        }

        if (pendingPhoto) {
          step = "фото";
          const updated = await uploadListingPhoto(token, id, pendingPhoto);
          setPhotoFileId(updated.photoFileId);
          setPendingPhoto(null);
        }
        if (pendingVideo) {
          step = "видео";
          const updated = await uploadListingVideo(token, id, pendingVideo);
          setVideoFileId(updated.videoFileId);
          setPendingVideo(null);
        }

        if (wasNew && isListed) {
          step = "публикацию";
          await updateListing(token, id, payload);
        }
      });
      toast.success(wasNew ? "Объявление создано" : "Объявление сохранено");
      onBack();
    } catch (err) {
      // The API layer already toasted the server's reason; explain what was affected.
      const reason =
        err instanceof ApiError && err.code === "availability_required"
          ? "Сначала задайте расписание — без него нельзя опубликовать объявление."
          : err instanceof ApiError && err.code === "video_too_long"
            ? "Видео должно быть короче 1 минуты."
            : err instanceof ApiError && err.code === "unsupported_media_type"
              ? "Неподдерживаемый формат файла."
              : err instanceof ApiError
                ? err.message
                : "Неизвестная ошибка";
      setError(
        wasNew && step !== "объявление"
          ? `Объявление создано, но не удалось сохранить ${step}: ${reason} Исправьте и нажмите «Сохранить» ещё раз.`
          : `Не удалось сохранить ${step}: ${reason}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const gallery = photoVideoGallery(photoFileId, videoFileId, title);

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack} disabled={saving}>
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

      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Фото и видео</h2>
        <p className={profileStyles.subtitle}>Файлы загрузятся вместе с объявлением, когда вы нажмёте «Сохранить».</p>

        {photoPreview ? (
          <img className={styles.listingPhoto} src={photoPreview} alt="Новое фото" />
        ) : (
          photoFileId && (
            <AuthenticatedImage token={token} fileId={photoFileId} alt={title} className={styles.listingPhoto} zoomable gallery={gallery.items} galleryIndex={gallery.photoIndex} />
          )
        )}
        <FilePicker
          icon="image"
          label={pendingPhoto ? pendingPhoto.name : photoFileId ? "Заменить фотографию" : "Выбрать фотографию"}
          hint="JPEG, PNG, WEBP или GIF"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onSelect={pickPhoto}
          disabled={saving}
        />
        {pendingPhoto && (
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setPendingPhoto(null)} disabled={saving}>
            Убрать выбранное фото
          </button>
        )}

        {videoPreview ? (
          <video className={styles.listingVideo} src={videoPreview} controls preload="metadata" />
        ) : (
          videoFileId && (
            <AuthenticatedVideo token={token} fileId={videoFileId} className={styles.listingVideo} zoomable gallery={gallery.items} galleryIndex={gallery.videoIndex} />
          )
        )}
        <FilePicker
          icon="video"
          label={pendingVideo ? pendingVideo.name : videoFileId ? "Заменить видео" : "Выбрать видео"}
          hint="MP4, MOV или WEBM, до 1 минуты и 100 МБ"
          accept="video/mp4,video/quicktime,video/webm"
          onSelect={(file) => void pickVideo(file)}
          disabled={saving}
        />
        {pendingVideo && (
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setPendingVideo(null)} disabled={saving}>
            Убрать выбранное видео
          </button>
        )}
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Недельное расписание</h2>
        <p className={profileStyles.subtitle}>Когда вы обычно свободны — из этого система нарежет слоты для записи.</p>

        {availabilityLoadError ? (
          <p className={profileStyles.error}>
            Не удалось загрузить текущее расписание: {availabilityLoadError}. Расписание не будет изменено при сохранении — обновите
            страницу, чтобы его отредактировать.
          </p>
        ) : !availabilityReady ? (
          <p className={profileStyles.subtitle}>Загрузка расписания…</p>
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

          </>
        )}
      </div>

      {error && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{error}</p>
        </div>
      )}

      <div className={profileStyles.formActions}>
        <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
