import { apiRequest, apiUpload } from "./client";
import { mapProfileMediaDto, type ProfileMedia, type ProfileMediaDto } from "../types/profileMedia";

export async function listProfileMedia(token: string, userId: string): Promise<ProfileMedia[]> {
  const dtos = await apiRequest<ProfileMediaDto[]>(`/api/profile/media/${userId}`, { token });
  return dtos.map(mapProfileMediaDto);
}

export async function uploadProfilePhoto(token: string, file: File, caption?: string | null): Promise<ProfileMedia> {
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);
  const dto = await apiUpload<ProfileMediaDto>("/api/profile/media/photo", { token, formData, successMessage: "Фото добавлено" });
  return mapProfileMediaDto(dto);
}

export async function uploadProfileVideo(token: string, file: File, caption?: string | null): Promise<ProfileMedia> {
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);
  const dto = await apiUpload<ProfileMediaDto>("/api/profile/media/video", { token, formData, successMessage: "Видео добавлено" });
  return mapProfileMediaDto(dto);
}

export async function deleteProfileMedia(token: string, mediaId: string): Promise<void> {
  await apiRequest(`/api/profile/media/${mediaId}`, { method: "DELETE", successMessage: "Удалено", token });
}
