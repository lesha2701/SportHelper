import { useEffect, useState } from "react";
import { fetchFileBlob } from "../../api/files";
import { MediaLightbox, type LightboxItem } from "./MediaLightbox";
import zoomStyles from "./zoomable.module.css";

interface AuthenticatedImageProps {
  token: string;
  fileId: string;
  alt: string;
  className?: string;
  /** Click opens the full-screen viewer. */
  zoomable?: boolean;
  /** With `zoomable`: page through this set of photos/videos instead of just this one. */
  gallery?: LightboxItem[];
  galleryIndex?: number;
}

export function AuthenticatedImage({
  token,
  fileId,
  alt,
  className,
  zoomable,
  gallery,
  galleryIndex,
}: AuthenticatedImageProps) {
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
        // Silently omit the image on failure; the surrounding UI already
        // has a text fallback for a missing logo.
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [token, fileId]);

  if (!objectUrl) {
    return <div className={className} aria-hidden="true" />;
  }

  if (!zoomable) {
    return <img className={className} src={objectUrl} alt={alt} />;
  }

  const items = gallery ?? [{ kind: "image" as const, fileId, alt }];
  return (
    <>
      <img
        className={`${className ?? ""} ${zoomStyles.zoomable}`}
        src={objectUrl}
        alt={alt}
        onClick={(e) => {
          e.stopPropagation();
          setViewing(true);
        }}
      />
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
