import { apiRequest, apiUpload } from "./client";
import { mapUserDto, type User, type UserDto } from "../types/user";

export async function uploadUserAvatar(token: string, file: File): Promise<User> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<UserDto>("/api/users/me/avatar", { token, formData, successMessage: "Аватар обновлён" });
  return mapUserDto(dto);
}

export async function removeUserAvatar(token: string): Promise<User> {
  const dto = await apiRequest<UserDto>("/api/users/me/avatar", { method: "DELETE", successMessage: "Аватар удалён", token });
  return mapUserDto(dto);
}

/** Records that the welcome guide was finished or skipped. No body and no user
 * id: the server only ever updates the signed-in user. Silent because the
 * caller (OnboardingGate) shows its own, softer message on failure. */
export async function completeOnboarding(token: string): Promise<User> {
  const dto = await apiRequest<UserDto>("/api/users/me/onboarding/complete", { method: "POST", token, silent: true });
  return mapUserDto(dto);
}
