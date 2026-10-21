import { useEffect, useMemo } from "react";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

/** Client-side pre-check of a picked video (the server enforces the same
 * limits) so a too-big/too-long file is rejected before the long upload. */
export function checkVideo(file: File): Promise<string | null> {
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

/** A temporary address for showing a file the person has just picked (released when it changes or the form closes). */
export function usePreviewUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}
