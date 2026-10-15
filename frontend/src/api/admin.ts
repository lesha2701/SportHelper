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

// --- users -------------------------------------------------------------------------------------------------------

export type UserStatus = "active" | "banned" | "unverified" | "deleted";
export type UserRoleFilter = "player" | "coach" | "none" | "admin";
export type UserSort = "created_desc" | "created_asc" | "active_desc" | "active_asc";

export interface AdminUserRow {
  id: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string;
  lastName: string | null;
  isPlayer: boolean;
  isCoach: boolean;
  isAdmin: boolean;
  status: UserStatus;
  deletionRequested: boolean;
  bannedUntil: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
}

export interface BanRecord {
  id: string;
  reason: string;
  bannedAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
  liftKind: "manual" | "expired" | null;
  liftReason: string | null;
  admin: string | null;
  liftedBy: string | null;
}

export interface ModerationEntry {
  id: string;
  action: string;
  reason: string | null;
  result: string;
  createdAt: string;
  admin: string | null;
}

export interface AdminUserCard extends AdminUserRow {
  banReason: string | null;
  bannedAt: string | null;
  telegramLinked: boolean;
  trainingsCreated: number;
  teamsCount: number;
  listingsCount: number;
  filesCount: number;
  bans: BanRecord[];
  history: ModerationEntry[];
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

interface UserRowDto {
  id: string;
  email: string | null;
  email_verified: boolean;
  first_name: string;
  last_name: string | null;
  is_player: boolean;
  is_coach: boolean;
  is_admin: boolean;
  status: UserStatus;
  deletion_requested: boolean;
  banned_until: string | null;
  created_at: string;
  last_active_at: string | null;
  last_login_at: string | null;
}

interface UserCardDto extends UserRowDto {
  ban_reason: string | null;
  banned_at: string | null;
  telegram_linked: boolean;
  trainings_created: number;
  teams_count: number;
  listings_count: number;
  files_count: number;
  bans: {
    id: string;
    reason: string;
    banned_at: string;
    expires_at: string | null;
    lifted_at: string | null;
    lift_kind: "manual" | "expired" | null;
    lift_reason: string | null;
    admin: string | null;
    lifted_by: string | null;
  }[];
  history: { id: string; action: string; reason: string | null; result: string; created_at: string; admin: string | null }[];
}

function mapRow(dto: UserRowDto): AdminUserRow {
  return {
    id: dto.id,
    email: dto.email,
    emailVerified: dto.email_verified,
    firstName: dto.first_name,
    lastName: dto.last_name,
    isPlayer: dto.is_player,
    isCoach: dto.is_coach,
    isAdmin: dto.is_admin,
    status: dto.status,
    deletionRequested: dto.deletion_requested,
    bannedUntil: dto.banned_until,
    createdAt: dto.created_at,
    lastActiveAt: dto.last_active_at,
    lastLoginAt: dto.last_login_at,
  };
}

function mapCard(dto: UserCardDto): AdminUserCard {
  return {
    ...mapRow(dto),
    banReason: dto.ban_reason,
    bannedAt: dto.banned_at,
    telegramLinked: dto.telegram_linked,
    trainingsCreated: dto.trainings_created,
    teamsCount: dto.teams_count,
    listingsCount: dto.listings_count,
    filesCount: dto.files_count,
    bans: dto.bans.map((b) => ({
      id: b.id,
      reason: b.reason,
      bannedAt: b.banned_at,
      expiresAt: b.expires_at,
      liftedAt: b.lifted_at,
      liftKind: b.lift_kind,
      liftReason: b.lift_reason,
      admin: b.admin,
      liftedBy: b.lifted_by,
    })),
    history: dto.history.map((h) => ({ id: h.id, action: h.action, reason: h.reason, result: h.result, createdAt: h.created_at, admin: h.admin })),
  };
}

export interface UserQuery {
  q: string;
  role: UserRoleFilter | "";
  status: UserStatus | "";
  sort: UserSort;
  limit: number;
  offset: number;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export async function listAdminUsers(query: UserQuery): Promise<Page<AdminUserRow>> {
  const dto = await apiRequest<{ total: number; limit: number; offset: number; items: UserRowDto[] }>(
    `/api/admin/users${queryString({ q: query.q.trim() || undefined, role: query.role, status: query.status, sort: query.sort, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(mapRow) };
}

export async function getAdminUser(id: string): Promise<AdminUserCard> {
  return mapCard(await apiRequest<UserCardDto>(`/api/admin/users/${id}`, QUIET));
}

export async function banAdminUser(id: string, reason: string, days: number | null): Promise<AdminUserCard> {
  return mapCard(
    await apiRequest<UserCardDto>(`/api/admin/users/${id}/ban`, {
      method: "POST",
      successMessage: "Пользователь заблокирован",
      body: { reason, days },
    }),
  );
}

export async function unbanAdminUser(id: string, reason: string): Promise<AdminUserCard> {
  return mapCard(
    await apiRequest<UserCardDto>(`/api/admin/users/${id}/unban`, {
      method: "POST",
      successMessage: "Блокировка снята",
      body: { reason },
    }),
  );
}

export { queryString };
