import { API_BASE_URL, ApiError } from "./client";

/** Downloads a file as a Blob. Sent with the session cookie (when there is
 * one): public files (avatars, coach-listing media) work for guests too. The
 * `token` argument is unused and only kept for the existing call sites.
 * `size: "thumb"` asks for the small copy used in lists and cards; the server
 * answers with the full file when a picture has no thumbnail. */
export async function fetchFileBlob(_token: string, fileId: string, size?: "thumb"): Promise<Blob> {
  let response: Response;
  try {
    const query = size ? `?size=${size}` : "";
    response = await fetch(`${API_BASE_URL}/api/files/${fileId}${query}`, { credentials: "include" });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }

  if (!response.ok) {
    throw new ApiError(response.status, "download_error", "Не удалось загрузить файл");
  }

  return response.blob();
}
