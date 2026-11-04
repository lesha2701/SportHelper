import { mapUserDto, type User, type UserDto } from "@/shared/types/user";
import { apiRequest } from "./client";

interface MobileAuthDto extends UserDto {
  access_token: string;
  expires_at: string;
}

export interface LoginResult {
  user: User;
  accessToken: string;
  expiresAt: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const dto = await apiRequest<MobileAuthDto>("/api/auth/mobile/login", { method: "POST", body: { email, password } });
  return { user: mapUserDto(dto), accessToken: dto.access_token, expiresAt: dto.expires_at };
}

/** The current session's user; throws ApiError(401) when the token is missing or no longer valid. */
export async function fetchMe(): Promise<User> {
  return mapUserDto(await apiRequest<UserDto>("/api/auth/me"));
}

export async function logout(): Promise<void> {
  await apiRequest("/api/auth/logout", { method: "POST" });
}
