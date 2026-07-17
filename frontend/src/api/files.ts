import { ApiError } from "./client";

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function fetchFileBlob(token: string, fileId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }

  if (!response.ok) {
    throw new ApiError(response.status, "download_error", "Не удалось загрузить файл");
  }

  return response.blob();
}
