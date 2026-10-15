import { apiRequest } from "./client";
import { mapUserDto, type Role, type User, type UserDto } from "../types/user";

interface AuthDto extends UserDto {
  csrf_token: string;
}

export interface AuthResult {
  user: User;
  /** Echoed as X-CSRF-Token on state-changing requests (held in memory only). */
  csrfToken: string;
}

function mapAuth(dto: AuthDto): AuthResult {
  return { user: mapUserDto(dto), csrfToken: dto.csrf_token };
}

/** Auth forms show their own inline errors, so the global error toast stays off. */
const QUIET = { silent: true } as const;

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  acceptTerms: boolean;
  role: Role | null;
  /** Where the visitor was heading; the confirmation email carries it back. */
  next?: string | null;
}

export async function register(input: RegisterInput): Promise<{ email: string }> {
  return apiRequest<{ email: string }>("/api/auth/register", {
    method: "POST",
    ...QUIET,
    body: {
      first_name: input.firstName,
      last_name: input.lastName || null,
      email: input.email,
      password: input.password,
      password_confirm: input.passwordConfirm,
      accept_terms: input.acceptTerms,
      role: input.role,
      next: input.next ?? null,
    },
  });
}

export async function login(email: string, password: string): Promise<AuthResult> {
  return mapAuth(await apiRequest<AuthDto>("/api/auth/login", { method: "POST", ...QUIET, body: { email, password } }));
}

/** The current session's user, or throws ApiError(401) for a guest. */
export async function fetchMe(): Promise<AuthResult> {
  return mapAuth(await apiRequest<AuthDto>("/api/auth/me", QUIET));
}

export async function logout(): Promise<void> {
  await apiRequest("/api/auth/logout", { method: "POST", ...QUIET });
}

export async function logoutAll(): Promise<void> {
  await apiRequest("/api/auth/logout-all", { method: "POST", successMessage: "Вы вышли на всех устройствах" });
}

export interface VerificationInfo {
  valid: boolean;
  /** Masked, e.g. a***e@example.com. */
  email: string | null;
  firstName: string | null;
}

/** Describes a confirmation link without spending it. */
export async function inspectVerification(token: string): Promise<VerificationInfo> {
  const dto = await apiRequest<{ valid: boolean; email: string | null; first_name: string | null }>(
    "/api/auth/verify-email/inspect",
    { method: "POST", ...QUIET, body: { token } },
  );
  return { valid: dto.valid, email: dto.email, firstName: dto.first_name };
}

/** Confirms the address. The password is the one the account was registered
 * with: a click on the link alone never activates a password someone else chose. */
export async function verifyEmail(token: string, password: string): Promise<{ email: string | null }> {
  return apiRequest<{ verified: boolean; email: string | null }>("/api/auth/verify-email", {
    method: "POST",
    ...QUIET,
    body: { token, password },
  });
}

/** For whoever controls the mailbox but isn't the person who registered (or forgot
 * that password): confirms the address AND replaces the password. */
export async function verifyEmailWithNewPassword(
  token: string,
  password: string,
  passwordConfirm: string,
): Promise<{ email: string | null }> {
  return apiRequest<{ verified: boolean; email: string | null }>("/api/auth/verify-email/set-password", {
    method: "POST",
    ...QUIET,
    body: { token, password, password_confirm: passwordConfirm },
  });
}

export async function resendVerification(email: string, next?: string | null): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/resend-verification", {
    method: "POST",
    ...QUIET,
    body: { email, next: next ?? null },
  });
  return dto.message;
}

export async function forgotPassword(email: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/forgot-password", {
    method: "POST",
    ...QUIET,
    body: { email },
  });
  return dto.message;
}

export async function resetPassword(token: string, password: string, passwordConfirm: string): Promise<void> {
  await apiRequest("/api/auth/reset-password", {
    method: "POST",
    ...QUIET,
    body: { token, password, password_confirm: passwordConfirm },
  });
}

export async function changePassword(current: string, next: string, nextConfirm: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/change-password", {
    method: "POST",
    ...QUIET,
    body: { current_password: current, new_password: next, new_password_confirm: nextConfirm },
  });
  return dto.message;
}

export async function changeEmail(newEmail: string, password: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/change-email", {
    method: "POST",
    ...QUIET,
    body: { new_email: newEmail, password },
  });
  return dto.message;
}

export async function confirmEmailChange(token: string): Promise<{ email: string | null }> {
  return apiRequest<{ verified: boolean; email: string | null }>("/api/auth/confirm-email-change", {
    method: "POST",
    ...QUIET,
    body: { token },
  });
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
  const dtos = await apiRequest<
    { id: string; device: string; ip_address: string | null; created_at: string; last_seen_at: string; current: boolean }[]
  >("/api/auth/sessions", QUIET);
  return dtos.map((s) => ({
    id: s.id,
    device: s.device,
    ipAddress: s.ip_address,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    current: s.current,
  }));
}

export async function revokeSession(id: string): Promise<void> {
  await apiRequest(`/api/auth/sessions/${id}`, { method: "DELETE", successMessage: "Сессия завершена" });
}

export async function requestAccountDeletion(password: string): Promise<string> {
  const dto = await apiRequest<{ message: string }>("/api/auth/account/delete", {
    method: "POST",
    ...QUIET,
    body: { password },
  });
  return dto.message;
}

export async function cancelAccountDeletion(): Promise<void> {
  await apiRequest("/api/auth/account/delete/cancel", { method: "POST", successMessage: "Удаление аккаунта отменено" });
}

export async function startTelegramLink(): Promise<{ botUrl: string; expiresIn: number }> {
  const dto = await apiRequest<{ bot_url: string; expires_in: number }>("/api/auth/telegram/link", { method: "POST", ...QUIET });
  return { botUrl: dto.bot_url, expiresIn: dto.expires_in };
}

export async function unlinkTelegram(): Promise<void> {
  await apiRequest("/api/auth/telegram/unlink", { method: "POST", successMessage: "Telegram отвязан" });
}

export async function inspectClaim(token: string): Promise<{ valid: boolean; firstName: string | null }> {
  const dto = await apiRequest<{ valid: boolean; first_name: string | null }>("/api/auth/claim/inspect", {
    method: "POST",
    ...QUIET,
    body: { token },
  });
  return { valid: dto.valid, firstName: dto.first_name };
}

export interface ClaimInput {
  token: string;
  email: string;
  password: string;
  passwordConfirm: string;
  acceptTerms: boolean;
}

export async function claimAccount(input: ClaimInput): Promise<{ email: string }> {
  return apiRequest<{ email: string }>("/api/auth/claim", {
    method: "POST",
    ...QUIET,
    body: {
      token: input.token,
      email: input.email,
      password: input.password,
      password_confirm: input.passwordConfirm,
      accept_terms: input.acceptTerms,
    },
  });
}

export interface MfaStatus {
  isAdmin: boolean;
  enabled: boolean;
  sessionVerified: boolean;
}

export async function getMfaStatus(): Promise<MfaStatus> {
  const dto = await apiRequest<{ is_admin: boolean; enabled: boolean; session_verified: boolean }>("/api/auth/mfa", QUIET);
  return { isAdmin: dto.is_admin, enabled: dto.enabled, sessionVerified: dto.session_verified };
}

/** Starting to enrol an authenticator asks for the password again. */
export async function setupMfa(password: string): Promise<{ secret: string; otpauthUri: string }> {
  const dto = await apiRequest<{ secret: string; otpauth_uri: string }>("/api/auth/mfa/setup", {
    method: "POST",
    ...QUIET,
    body: { password },
  });
  return { secret: dto.secret, otpauthUri: dto.otpauth_uri };
}

export async function enableMfa(code: string): Promise<string[]> {
  const dto = await apiRequest<{ recovery_codes: string[] }>("/api/auth/mfa/enable", {
    method: "POST",
    ...QUIET,
    body: { code },
  });
  return dto.recovery_codes;
}

export async function verifyMfa(code: string): Promise<void> {
  await apiRequest("/api/auth/mfa/verify", { method: "POST", ...QUIET, body: { code } });
}

export async function disableMfa(password: string, code: string): Promise<void> {
  await apiRequest("/api/auth/mfa/disable", { method: "POST", ...QUIET, body: { password, code } });
}
