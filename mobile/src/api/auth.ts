import type { ConsentKey, DocumentKey } from "@/shared/legal/documents";
import { mapUserDto, type Role, type User, type UserDto } from "@/shared/types/user";
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

function mapLogin(dto: MobileAuthDto): LoginResult {
  return { user: mapUserDto(dto), accessToken: dto.access_token, expiresAt: dto.expires_at };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return mapLogin(await apiRequest<MobileAuthDto>("/api/auth/mobile/login", { method: "POST", body: { email, password } }));
}

/** The current session's user; throws ApiError(401) when the token is missing or no longer valid. */
export async function fetchMe(): Promise<User> {
  return mapUserDto(await apiRequest<UserDto>("/api/auth/me"));
}

export async function logout(): Promise<void> {
  await apiRequest("/api/auth/logout", { method: "POST" });
}

export async function logoutAll(): Promise<void> {
  await apiRequest("/api/auth/logout-all", { method: "POST" });
}

export interface ConsentAcceptance {
  key: ConsentKey;
  documents: { key: DocumentKey; version: string }[];
}

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  role: Role;
  consents: ConsentAcceptance[];
}

export async function register(input: RegisterInput): Promise<{ email: string }> {
  return apiRequest<{ email: string }>("/api/auth/register", {
    method: "POST",
    body: {
      first_name: input.firstName,
      last_name: input.lastName || null,
      email: input.email,
      password: input.password,
      password_confirm: input.passwordConfirm,
      role: input.role,
      consents: input.consents,
      next: null,
    },
  });
}

/** Confirms the address with the registration password. The session is present when that also signed the person in. */
export async function verifyEmail(token: string, password: string): Promise<{ email: string | null; session: LoginResult | null }> {
  const dto = await apiRequest<{ verified: boolean; email: string | null; session?: MobileAuthDto | null }>(
    "/api/auth/mobile/verify-email",
    { method: "POST", body: { token, password } },
  );
  return { email: dto.email, session: dto.session ? mapLogin(dto.session) : null };
}

export async function resendVerification(email: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/resend-verification", { method: "POST", body: { email, next: null } });
  return dto.message;
}

export async function forgotPassword(email: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: { email } });
  return dto.message;
}

export async function resetPassword(token: string, password: string, passwordConfirm: string): Promise<void> {
  await apiRequest("/api/auth/reset-password", { method: "POST", body: { token, password, password_confirm: passwordConfirm } });
}

export async function changePassword(current: string, next: string, nextConfirm: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/change-password", {
    method: "POST",
    body: { current_password: current, new_password: next, new_password_confirm: nextConfirm },
  });
  return dto.message;
}

export async function changeEmail(newEmail: string, password: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/change-email", { method: "POST", body: { new_email: newEmail, password } });
  return dto.message;
}

export interface Session {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export async function listSessions(): Promise<Session[]> {
  const dtos = await apiRequest<{ id: string; device: string; ip_address: string | null; created_at: string; last_seen_at: string; current: boolean }[]>(
    "/api/auth/sessions",
  );
  return dtos.map((s) => ({ id: s.id, device: s.device, ipAddress: s.ip_address, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.current }));
}

export async function revokeSession(id: string): Promise<void> {
  await apiRequest(`/api/auth/sessions/${id}`, { method: "DELETE", successMessage: "Сессия завершена" });
}

export async function requestAccountDeletion(password: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/account/delete", { method: "POST", body: { password } });
  return dto.message;
}

export async function cancelAccountDeletion(): Promise<void> {
  await apiRequest("/api/auth/account/delete/cancel", { method: "POST", successMessage: "Удаление аккаунта отменено" });
}

/** Confirms the new address from the link the email-change letter sent to it (the token is the proof). */
export async function confirmEmailChange(token: string): Promise<{ email: string | null }> {
  return apiRequest<{ verified: boolean; email: string | null }>("/api/auth/confirm-email-change", { method: "POST", body: { token } });
}
