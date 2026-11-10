import { apiRequest, apiUpload, type UploadFile } from "./client";
import { mapProfileMediaDto, type ProfileMedia, type ProfileMediaDto } from "@/shared/types/profileMedia";

export async function listProfileMedia(userId: string): Promise<ProfileMedia[]> {
  const dtos = await apiRequest<ProfileMediaDto[]>(`/api/profile/media/${userId}`);
  return dtos.map(mapProfileMediaDto);
}

export async function uploadProfilePhoto(file: UploadFile, caption?: string | null): Promise<ProfileMedia> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  if (caption) formData.append("caption", caption);
  const dto = await apiUpload<ProfileMediaDto>("/api/profile/media/photo", { formData, successMessage: "Фото добавлено" });
  return mapProfileMediaDto(dto);
}

export async function uploadProfileVideo(file: UploadFile, caption?: string | null): Promise<ProfileMedia> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  if (caption) formData.append("caption", caption);
  const dto = await apiUpload<ProfileMediaDto>("/api/profile/media/video", { formData, successMessage: "Видео добавлено" });
  return mapProfileMediaDto(dto);
}

export async function deleteProfileMedia(mediaId: string): Promise<void> {
  await apiRequest(`/api/profile/media/${mediaId}`, { method: "DELETE", successMessage: "Удалено" });
}
