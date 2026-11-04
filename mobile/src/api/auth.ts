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
