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
  preferredRole: Role | null;
  isAdmin: boolean;
  completedOnboardingVersion: number;
  currentOnboardingVersion: number;
}

/** Shape returned by the backend (snake_case). */
export interface UserDto {
  id: string;
  email: string | null;
  email_verified?: boolean;
  username: string | null;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  avatar_file_id: string | null;
  preferred_role?: Role | null;
  is_admin?: boolean;
  completed_onboarding_version?: number;
  current_onboarding_version?: number;
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
    preferredRole: dto.preferred_role ?? null,
    isAdmin: dto.is_admin ?? false,
    completedOnboardingVersion: dto.completed_onboarding_version ?? 0,
    currentOnboardingVersion: dto.current_onboarding_version ?? 0,
  };
}

export function isOnboardingDue(user: User): boolean {
  return user.completedOnboardingVersion < user.currentOnboardingVersion;
}
