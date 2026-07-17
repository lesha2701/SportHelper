import { useEffect, useState } from "react";
import { fetchFileBlob } from "../../api/files";

interface AuthenticatedVideoProps {
  token: string;
  fileId: string;
  className?: string;
}

export function AuthenticatedVideo({ token, fileId, className }: AuthenticatedVideoProps) {
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

  return <video className={className} src={objectUrl} controls preload="metadata" />;
}
