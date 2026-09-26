import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchFileBlob } from "../../api/files";
import { Icon } from "./Icon";
import styles from "./MediaLightbox.module.css";

export interface LightboxItem {
  kind: "image" | "video";
  fileId: string;
  alt?: string;
}

interface MediaLightboxProps {
  token: string;
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
}

/** Full-screen viewer for photos and videos, with prev/next paging (arrow
 * keys, on-screen arrows, swipe) when there is more than one item. */
export function MediaLightbox({ token, items, startIndex, onClose }: MediaLightboxProps) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), items.length - 1));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const urlsRef = useRef<Record<string, string>>({});
  const touchStartX = useRef<number | null>(null);

  const item = items[index];
  const hasMany = items.length > 1;

  const go = useCallback(
    (delta: number) => setIndex((current) => (current + delta + items.length) % items.length),
    [items.length],
  );

  useEffect(() => {
    if (!item || urlsRef.current[item.fileId] || failed[item.fileId]) return;
    let cancelled = false;
    fetchFileBlob(token, item.fileId)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        urlsRef.current[item.fileId] = url;
        setUrls({ ...urlsRef.current });
      })
      .catch(() => {
        if (!cancelled) setFailed((prev) => ({ ...prev, [item.fileId]: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [token, item, failed]);

  useEffect(
    () => () => {
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = {};
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasMany) go(-1);
      else if (event.key === "ArrowRight" && hasMany) go(1);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, go, hasMany]);

  if (!item) return null;
  const url = urls[item.fileId];

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр медиа"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (!hasMany || start === null || end === undefined || Math.abs(end - start) < 50) return;
        go(end < start ? 1 : -1);
      }}
    >
      <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
        <Icon name="x" size={22} />
      </button>

      {hasMany && (
        <button
          type="button"
          className={`${styles.nav} ${styles.navPrev}`}
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Предыдущее"
        >
          <Icon name="chevron-left" size={26} />
        </button>
      )}

      <div className={styles.stage} onClick={(e) => e.stopPropagation()}>
        {failed[item.fileId] ? (
          <p className={styles.message}>Не удалось загрузить файл</p>
        ) : !url ? (
          <p className={styles.message}>Загрузка…</p>
        ) : item.kind === "video" ? (
          <video key={item.fileId} className={styles.media} src={url} controls autoPlay playsInline />
        ) : (
          <img key={item.fileId} className={styles.media} src={url} alt={item.alt ?? ""} />
        )}
      </div>

      {hasMany && (
        <button
          type="button"
          className={`${styles.nav} ${styles.navNext}`}
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Следующее"
        >
          <Icon name="chevron-right" size={26} />
        </button>
      )}

      {hasMany && (
        <div className={styles.counter} onClick={(e) => e.stopPropagation()}>
          {index + 1} / {items.length}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** The photo + video pair most entities carry, as one pageable set. */
export function photoVideoGallery(
  photoFileId: string | null | undefined,
  videoFileId: string | null | undefined,
  alt: string,
): { items: LightboxItem[]; photoIndex: number; videoIndex: number } {
  const items: LightboxItem[] = [];
  if (photoFileId) items.push({ kind: "image", fileId: photoFileId, alt });
  if (videoFileId) items.push({ kind: "video", fileId: videoFileId });
  return { items, photoIndex: 0, videoIndex: photoFileId ? 1 : 0 };
}
