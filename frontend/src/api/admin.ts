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

export interface DayCount {
  /** An ISO calendar date (UTC). */
  day: string;
  count: number;
}

export interface AdminDashboard {
  users: { total: number; newToday: number; new7d: number; new30d: number; players: number; coaches: number; banned: number };
  activity: { dau: number; wau: number; mau: number; trackingSince: string | null };
  trainings: { total: number; active: number; upcoming: number; completed: number };
  bookings: { total: number; confirmed: number; upcoming: number };
  registrations: DayCount[];
  activeUsers: DayCount[];
  trainingsCreated: DayCount[];
  bookingsCreated: DayCount[];
}

interface DashboardDto {
  users: { total: number; new_today: number; new_7d: number; new_30d: number; players: number; coaches: number; banned: number };
  activity: { dau: number; wau: number; mau: number; tracking_since: string | null };
  trainings: { total: number; active: number; upcoming: number; completed: number };
  bookings: { total: number; confirmed: number; upcoming: number };
  registrations: DayCount[];
  active_users: DayCount[];
  trainings_created: DayCount[];
  bookings_created: DayCount[];
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const dto = await apiRequest<DashboardDto>("/api/admin/dashboard", QUIET);
  return {
    users: {
      total: dto.users.total,
      newToday: dto.users.new_today,
      new7d: dto.users.new_7d,
      new30d: dto.users.new_30d,
      players: dto.users.players,
      coaches: dto.users.coaches,
      banned: dto.users.banned,
    },
    activity: { dau: dto.activity.dau, wau: dto.activity.wau, mau: dto.activity.mau, trackingSince: dto.activity.tracking_since },
    trainings: dto.trainings,
    bookings: dto.bookings,
    registrations: dto.registrations,
    activeUsers: dto.active_users,
    trainingsCreated: dto.trainings_created,
    bookingsCreated: dto.bookings_created,
  };
}
