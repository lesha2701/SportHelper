import { useEffect, useState } from "react";
import { fetchFileBlob } from "../../api/files";

interface AuthenticatedImageProps {
  token: string;
  fileId: string;
  alt: string;
  className?: string;
}

export function AuthenticatedImage({ token, fileId, alt, className }: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

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

  return <img className={className} src={objectUrl} alt={alt} />;
}
