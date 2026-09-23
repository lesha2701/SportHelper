import { useEffect, useState } from "react";
import { deleteProfileMedia, listProfileMedia, uploadProfilePhoto, uploadProfileVideo } from "../../api/profileMedia";
import { ApiError } from "../../api/client";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { Icon } from "../shared/Icon";
import type { ProfileMedia } from "../../types/profileMedia";
import styles from "./profile.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: ProfileMedia[] };

/** A user's achievements/highlights gallery — many photos and videos, shown
 * on their own profile (editable) or on someone else's (read-only). */
export function AchievementsGallery({ token, userId, editable }: { token: string; userId: string; editable: boolean }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProfileMedia(token, userId)
      .then((items) => setState({ status: "ready", items }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить достижения" }));
  }, [token, userId]);

  const handleAddPhoto = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const created = await uploadProfilePhoto(token, file);
      setState((prev) => (prev.status === "ready" ? { status: "ready", items: [...prev.items, created] } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  };

  const handleAddVideo = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const created = await uploadProfileVideo(token, file);
      setState((prev) => (prev.status === "ready" ? { status: "ready", items: [...prev.items, created] } : prev));
    } catch (err) {
      if (err instanceof ApiError && err.code === "video_too_long") {
        setError("Видео должно быть короче 1 минуты.");
      } else if (err instanceof ApiError && err.code === "unsupported_media_type") {
        setError("Видео должно быть в формате MP4, MOV или WEBM.");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (mediaId: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteProfileMedia(token, mediaId);
      setState((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.filter((m) => m.id !== mediaId) } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") return null;
  if (state.status === "error") return <p className={styles.error}>{state.message}</p>;

  if (state.items.length === 0 && !editable) return null;

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Достижения</h2>
      {error && <p className={styles.error}>{error}</p>}
      {state.items.length === 0 && !editable && <p className={styles.subtitle}>Пока ничего не добавлено.</p>}

      <div className={styles.mediaGrid}>
        {state.items.map((item) => (
          <div className={styles.mediaTile} key={item.id}>
            {item.mediaType === "photo" ? (
              <AuthenticatedImage token={token} fileId={item.fileId} alt={item.caption ?? "Достижение"} className={styles.mediaTileMedia} />
            ) : (
              <AuthenticatedVideo token={token} fileId={item.fileId} className={styles.mediaTileMedia} />
            )}
            {editable && (
              <button
                type="button"
                className={styles.mediaTileDelete}
                onClick={() => void handleDelete(item.id)}
                disabled={busy}
                aria-label="Удалить"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        ))}

        {editable && (
          <>
            <label className={styles.mediaAddTile}>
              <Icon name="image" size={20} />
              Фото
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className={styles.mediaAddTileInput}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleAddPhoto(file);
                }}
              />
            </label>
            <label className={styles.mediaAddTile} title="MP4, MOV или WEBM — до 1 минуты и 100 МБ">
              <Icon name="video" size={20} />
              Видео
              <span style={{ opacity: 0.7 }}>до 1 мин</span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className={styles.mediaAddTileInput}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleAddVideo(file);
                }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
