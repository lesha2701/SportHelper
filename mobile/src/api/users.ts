import { mapUserDto, type User, type UserDto } from "@/shared/types/user";
import { apiRequest, apiUpload, type UploadFile } from "./client";

export async function uploadUserAvatar(file: UploadFile): Promise<User> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  return mapUserDto(await apiUpload<UserDto>("/api/users/me/avatar", { formData, successMessage: "Фото обновлено" }));
}

export async function removeUserAvatar(): Promise<User> {
  return mapUserDto(await apiRequest<UserDto>("/api/users/me/avatar", { method: "DELETE", successMessage: "Фото удалено" }));
}

/** Records on the account that the welcome guide was finished or skipped, so it is not shown again (as on the website). */
export async function completeOnboarding(): Promise<User> {
  return mapUserDto(await apiRequest<UserDto>("/api/users/me/onboarding/complete", { method: "POST" }));
}
