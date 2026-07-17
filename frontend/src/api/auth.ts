import { apiRequest } from "./client";
import { mapUserDto, type User, type UserDto } from "../types/user";

interface AuthResponseDto {
  access_token: string;
  token_type: string;
  user: UserDto;
}

export interface AuthResult {
  accessToken: string;
  user: User;
}

export async function loginWithTelegram(initDataRaw: string): Promise<AuthResult> {
  const dto = await apiRequest<AuthResponseDto>("/api/auth/telegram", {
    method: "POST",
    body: { init_data: initDataRaw },
  });
  return { accessToken: dto.access_token, user: mapUserDto(dto.user) };
}

export async function fetchCurrentUser(token: string): Promise<User> {
  const dto = await apiRequest<UserDto>("/api/auth/me", { token });
  return mapUserDto(dto);
}
