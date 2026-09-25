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

/** Dev-only: logs in as a fixed dev user, skipping Telegram entirely. Only
 * called when import.meta.env.DEV (see AuthContext) — the endpoint itself
 * only exists on the backend when DEV_AUTH_ENABLED is set, see
 * docs/dev-notes.md. */
export async function devLogin(): Promise<AuthResult> {
  const dto = await apiRequest<AuthResponseDto>("/api/auth/dev-login", { method: "POST" });
  return { accessToken: dto.access_token, user: mapUserDto(dto.user) };
}

/** Dev-only: logs in as a second fixed dev user, so a two-sided flow (e.g.
 * an athlete booking a coach's own session) can be exercised locally with
 * two distinct browser tabs. Opt in by loading the app with `?devUser=2`
 * in the URL — see AuthContext. */
export async function devLogin2(): Promise<AuthResult> {
  const dto = await apiRequest<AuthResponseDto>("/api/auth/dev-login-2", { method: "POST" });
  return { accessToken: dto.access_token, user: mapUserDto(dto.user) };
}

export async function fetchCurrentUser(token: string): Promise<User> {
  const dto = await apiRequest<UserDto>("/api/auth/me", { token });
  return mapUserDto(dto);
}

export interface BrowserLoginStart {
  token: string;
  botUrl: string;
  expiresIn: number;
}

export async function startBrowserLogin(): Promise<BrowserLoginStart> {
  const dto = await apiRequest<{ token: string; bot_url: string; expires_in: number }>(
    "/api/auth/browser/start",
    { method: "POST" },
  );
  return { token: dto.token, botUrl: dto.bot_url, expiresIn: dto.expires_in };
}

export type BrowserLoginPoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ok"; result: AuthResult };

export async function pollBrowserLogin(token: string): Promise<BrowserLoginPoll> {
  const dto = await apiRequest<{ status: string; auth: AuthResponseDto | null }>("/api/auth/browser/poll", {
    method: "POST",
    body: { token },
  });
  if (dto.status === "ok" && dto.auth) {
    return { status: "ok", result: { accessToken: dto.auth.access_token, user: mapUserDto(dto.auth.user) } };
  }
  return { status: dto.status === "pending" ? "pending" : "expired" };
}
