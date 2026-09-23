import { apiRequest, apiUpload } from "./client";
import { mapUserDto, type User, type UserDto } from "../types/user";

export async function uploadUserAvatar(token: string, file: File): Promise<User> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<UserDto>("/api/users/me/avatar", { token, formData });
  return mapUserDto(dto);
}

export async function removeUserAvatar(token: string): Promise<User> {
  const dto = await apiRequest<UserDto>("/api/users/me/avatar", { method: "DELETE", token });
  return mapUserDto(dto);
}
