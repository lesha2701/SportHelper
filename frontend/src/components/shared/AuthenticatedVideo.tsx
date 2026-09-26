import { useEffect, useState } from "react";
import { fetchFileBlob } from "../../api/files";
import { MediaLightbox, type LightboxItem } from "./MediaLightbox";
import zoomStyles from "./zoomable.module.css";

interface AuthenticatedVideoProps {
  token: string;
  fileId: string;
  className?: string;
  /** Shows a still frame with a play badge; click opens the full-screen player. */
  zoomable?: boolean;
  /** With `zoomable`: page through this set of photos/videos instead of just this one. */
  gallery?: LightboxItem[];
  galleryIndex?: number;
}

export function AuthenticatedVideo({ token, fileId, className, zoomable, gallery, galleryIndex }: AuthenticatedVideoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    fetchFileBlob(token, fileId)
      .then((blob) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        // Silently omit the video on failure; surrounding UI has its own fallback.
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [token, fileId]);

  if (!objectUrl) {
    return null;
  }

  if (!zoomable) {
    return <video className={className} src={objectUrl} controls preload="metadata" />;
  }

  const items = gallery ?? [{ kind: "video" as const, fileId }];
  return (
    <>
      <span
        className={zoomStyles.videoFrame}
        role="button"
        tabIndex={0}
        aria-label="Открыть видео"
        onClick={(e) => {
          e.stopPropagation();
          setViewing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setViewing(true);
          }
        }}
      >
        {/* #t=0.1 makes the browser paint a frame instead of a black box */}
        <video className={className} src={`${objectUrl}#t=0.1`} muted playsInline preload="metadata" />
        <span className={zoomStyles.playBadge} />
      </span>
      {viewing && (
        <MediaLightbox
          token={token}
          items={items}
          startIndex={gallery ? (galleryIndex ?? 0) : 0}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  );
}
