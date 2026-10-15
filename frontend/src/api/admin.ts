import { apiRequest } from "./client";

/** Admin endpoints are all server-checked on every call (administrator + second factor); nothing here
 * grants anything - the UI only follows what the server answers. Errors are shown by the pages. */
const QUIET = { silent: true } as const;

export interface AdminSession {
  isAdmin: boolean;
  mfaEnabled: boolean;
  /** The code was entered in this session recently enough for ordinary admin work. */
  mfaVerified: boolean;
  /** ...and recently enough for irreversible actions. */
  mfaRecent: boolean;
}

export async function getAdminSession(): Promise<AdminSession> {
  const dto = await apiRequest<{ is_admin: boolean; mfa_enabled: boolean; mfa_verified: boolean; mfa_recent: boolean }>(
    "/api/admin/session",
    QUIET,
  );
  return { isAdmin: dto.is_admin, mfaEnabled: dto.mfa_enabled, mfaVerified: dto.mfa_verified, mfaRecent: dto.mfa_recent };
}

export interface AdminOverview {
  totalUsers: number;
  bannedUsers: number;
  totalTeams: number;
  totalTrainings: number;
  totalMatches: number;
  totalTasks: number;
  pendingNotifications: number;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const dto = await apiRequest<{
    total_users: number;
    banned_users: number;
    total_teams: number;
    total_trainings: number;
    total_matches: number;
    total_tasks: number;
    pending_notifications: number;
  }>("/api/admin/overview", QUIET);
  return {
    totalUsers: dto.total_users,
    bannedUsers: dto.banned_users,
    totalTeams: dto.total_teams,
    totalTrainings: dto.total_trainings,
    totalMatches: dto.total_matches,
    totalTasks: dto.total_tasks,
    pendingNotifications: dto.pending_notifications,
  };
}
