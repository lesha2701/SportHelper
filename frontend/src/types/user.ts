export type Role = "player" | "coach";

export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  avatarFileId: string | null;
  languageCode: string | null;
  /** The role picked at sign-up; only a hint for the first-run screen. */
  preferredRole: Role | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** Telegram is an optional notification channel, not a way to sign in. */
  telegramLinked: boolean;
  isAdmin: boolean;
  /** Set while an account deletion is scheduled (and can still be cancelled). */
  deletionRequestedAt: string | null;
  /** Welcome-guide version this account has finished; due while < currentOnboardingVersion. */
  completedOnboardingVersion: number;
  currentOnboardingVersion: number;
}

/** Shape returned by the backend (snake_case), before mapping to `User`. */
export interface UserDto {
  id: string;
  email: string | null;
  email_verified: boolean;
  username: string | null;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  avatar_file_id: string | null;
  language_code: string | null;
  preferred_role: Role | null;
  created_at: string;
  last_login_at: string | null;
  telegram_linked: boolean;
  is_admin: boolean;
  deletion_requested_at: string | null;
  completed_onboarding_version: number;
  current_onboarding_version: number;
}

export function mapUserDto(dto: UserDto): User {
  return {
    id: dto.id,
    email: dto.email ?? null,
    emailVerified: dto.email_verified ?? false,
    username: dto.username,
    firstName: dto.first_name,
    lastName: dto.last_name,
    photoUrl: dto.photo_url,
    avatarFileId: dto.avatar_file_id,
    languageCode: dto.language_code,
    preferredRole: dto.preferred_role ?? null,
    createdAt: dto.created_at,
    lastLoginAt: dto.last_login_at,
    telegramLinked: dto.telegram_linked ?? false,
    isAdmin: dto.is_admin ?? false,
    deletionRequestedAt: dto.deletion_requested_at ?? null,
    completedOnboardingVersion: dto.completed_onboarding_version ?? 0,
    currentOnboardingVersion: dto.current_onboarding_version ?? 0,
  };
}

/** Whether the welcome guide should be shown automatically. */
export function isOnboardingDue(user: User): boolean {
  return user.completedOnboardingVersion < user.currentOnboardingVersion;
}
