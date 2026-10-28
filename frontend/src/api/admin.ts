import { API_BASE_URL, ApiError, apiRequest } from "./client";

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
  /** This administrator may also see and handle money (listed in FINANCE_ADMIN_EMAILS on the server). */
  finance: boolean;
}

export async function getAdminSession(): Promise<AdminSession> {
  const dto = await apiRequest<{ is_admin: boolean; mfa_enabled: boolean; mfa_verified: boolean; mfa_recent: boolean; finance?: boolean }>(
    "/api/admin/session",
    QUIET,
  );
  return { isAdmin: dto.is_admin, mfaEnabled: dto.mfa_enabled, mfaVerified: dto.mfa_verified, mfaRecent: dto.mfa_recent, finance: dto.finance === true };
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
  moderation: { newComplaints: number; contentPending: number };
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
  moderation: { new_complaints: number; content_pending: number };
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
    moderation: { newComplaints: dto.moderation.new_complaints, contentPending: dto.moderation.content_pending },
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

// --- media moderation ----------------------------------------------------------------------------------------------

export type MediaKind = "avatar" | "logo" | "listing" | "gallery" | "exercise" | "training";
export type MediaState = "visible" | "hidden";

export interface AdminMedia {
  id: string;
  kind: MediaKind | "other";
  mediaType: "image" | "video" | "other";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  owner: { id: string; email: string | null; name: string };
  hidden: boolean;
  hiddenAt: string | null;
  moderationReason: string | null;
  hiddenBy: string | null;
  hasThumb: boolean;
}

export interface AdminMediaDetail extends AdminMedia {
  related: { type: string; id: string; label: string } | null;
  openComplaints: number;
}

interface MediaDto {
  id: string;
  kind: MediaKind | "other";
  media_type: "image" | "video" | "other";
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  owner: { id: string; email: string | null; name: string };
  hidden: boolean;
  hidden_at: string | null;
  moderation_reason: string | null;
  hidden_by: string | null;
  has_thumb: boolean;
  related?: { type: string; id: string; label: string } | null;
  open_complaints?: number;
}

function mapMedia(dto: MediaDto): AdminMedia {
  return {
    id: dto.id,
    kind: dto.kind,
    mediaType: dto.media_type,
    filename: dto.filename,
    mimeType: dto.mime_type,
    sizeBytes: dto.size_bytes,
    createdAt: dto.created_at,
    owner: dto.owner,
    hidden: dto.hidden,
    hiddenAt: dto.hidden_at,
    moderationReason: dto.moderation_reason,
    hiddenBy: dto.hidden_by,
    hasThumb: dto.has_thumb,
  };
}

function mapMediaDetail(dto: MediaDto): AdminMediaDetail {
  return { ...mapMedia(dto), related: dto.related ?? null, openComplaints: dto.open_complaints ?? 0 };
}

export interface MediaQuery {
  q: string;
  kind: MediaKind | "";
  mediaType: "image" | "video" | "";
  state: MediaState | "";
  limit: number;
  offset: number;
}

export async function listAdminMedia(query: MediaQuery): Promise<Page<AdminMedia>> {
  const dto = await apiRequest<{ total: number; limit: number; offset: number; items: MediaDto[] }>(
    `/api/admin/media${queryString({ q: query.q.trim() || undefined, kind: query.kind, media_type: query.mediaType, state: query.state, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(mapMedia) };
}

export async function getAdminMedia(id: string): Promise<AdminMediaDetail> {
  return mapMediaDetail(await apiRequest<MediaDto>(`/api/admin/media/${id}`, QUIET));
}

export async function hideAdminMedia(id: string, reason: string): Promise<AdminMediaDetail> {
  return mapMediaDetail(await apiRequest<MediaDto>(`/api/admin/media/${id}/hide`, { method: "POST", successMessage: "Файл скрыт", body: { reason } }));
}

export async function restoreAdminMedia(id: string, reason: string): Promise<AdminMediaDetail> {
  return mapMediaDetail(await apiRequest<MediaDto>(`/api/admin/media/${id}/restore`, { method: "POST", successMessage: "Файл восстановлен", body: { reason } }));
}

export async function deleteAdminMedia(id: string, reason: string): Promise<{ deleted: boolean; storageDeleted: boolean }> {
  const dto = await apiRequest<{ deleted: boolean; storage_deleted: boolean }>(`/api/admin/media/${id}/delete`, {
    method: "POST",
    silent: true,
    body: { reason, confirm: true },
  });
  return { deleted: dto.deleted, storageDeleted: dto.storage_deleted };
}

/** The file itself for the moderator's preview (hidden files included); sent with the session cookie. */
export async function fetchAdminMediaBlob(id: string, size?: "thumb"): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/admin/media/${id}/content${size ? `?size=${size}` : ""}`, { credentials: "include" });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }
  if (!response.ok) throw new ApiError(response.status, "download_error", "Не удалось загрузить файл");
  return response.blob();
}

// --- trainings and listings ----------------------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  email: string | null;
}

export type TrainingStatus = "scheduled" | "completed" | "cancelled";
export type TrainingKind = "team" | "personal" | "independent";

export interface AdminTraining {
  id: string;
  type: TrainingKind;
  status: TrainingStatus;
  trainingDate: string;
  startTime: string;
  durationMinutes: number;
  location: string | null;
  description: string | null;
  team: { id: string; name: string } | null;
  creator: Person;
  participants: number;
  bookings: number;
  createdAt: string;
}

export interface AdminTrainingDetail extends AdminTraining {
  planName: string | null;
  reminderMinutesBefore: number | null;
  recurring: boolean;
  participantList: { id: string; name: string; attendance: string | null }[];
  bookingList: { id: string; status: string; startsAt: string; format: string; coach: string; athlete: string }[];
}

interface TrainingDto {
  id: string;
  type: TrainingKind;
  status: TrainingStatus;
  training_date: string;
  start_time: string;
  duration_minutes: number;
  location: string | null;
  description: string | null;
  team: { id: string; name: string } | null;
  creator: Person;
  participants: number;
  bookings: number;
  created_at: string;
  plan_name?: string | null;
  reminder_minutes_before?: number | null;
  recurring?: boolean;
  participant_list?: { id: string; name: string; attendance: string | null }[];
  booking_list?: { id: string; status: string; starts_at: string; format: string; coach: string; athlete: string }[];
}

function mapTraining(dto: TrainingDto): AdminTraining {
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    trainingDate: dto.training_date,
    startTime: dto.start_time,
    durationMinutes: dto.duration_minutes,
    location: dto.location,
    description: dto.description,
    team: dto.team,
    creator: dto.creator,
    participants: dto.participants,
    bookings: dto.bookings,
    createdAt: dto.created_at,
  };
}

export interface TrainingQuery {
  q: string;
  status: TrainingStatus | "";
  type: TrainingKind | "";
  when: "upcoming" | "past" | "";
  sort: "date_desc" | "date_asc";
  limit: number;
  offset: number;
}

export async function listAdminTrainings(query: TrainingQuery): Promise<Page<AdminTraining>> {
  const dto = await apiRequest<{ total: number; limit: number; offset: number; items: TrainingDto[] }>(
    `/api/admin/trainings${queryString({ q: query.q.trim() || undefined, status: query.status, type: query.type, when: query.when, sort: query.sort, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(mapTraining) };
}

export async function getAdminTraining(id: string): Promise<AdminTrainingDetail> {
  const dto = await apiRequest<TrainingDto>(`/api/admin/trainings/${id}`, QUIET);
  return {
    ...mapTraining(dto),
    planName: dto.plan_name ?? null,
    reminderMinutesBefore: dto.reminder_minutes_before ?? null,
    recurring: dto.recurring ?? false,
    participantList: dto.participant_list ?? [],
    bookingList: (dto.booking_list ?? []).map((b) => ({ id: b.id, status: b.status, startsAt: b.starts_at, format: b.format, coach: b.coach, athlete: b.athlete })),
  };
}

export type ListingState = "public" | "hidden" | "unlisted" | "deleted";

export interface AdminListing {
  id: string;
  title: string;
  coach: Person;
  coachBlocked: boolean;
  pricePerSession: number | null;
  currency: string;
  location: string | null;
  state: ListingState;
  moderationReason: string | null;
  hiddenBy: string | null;
  hiddenAt: string | null;
  activeBookings: number;
  hasPhoto: boolean;
  hasVideo: boolean;
  createdAt: string;
  description?: string | null;
  openComplaints?: number;
}

interface ListingDto {
  id: string;
  title: string;
  coach: Person;
  coach_blocked: boolean;
  price_per_session: number | null;
  currency: string;
  location: string | null;
  state: ListingState;
  moderation_reason: string | null;
  hidden_by: string | null;
  hidden_at: string | null;
  active_bookings: number;
  has_photo: boolean;
  has_video: boolean;
  created_at: string;
  description?: string | null;
  open_complaints?: number;
}

function mapListing(dto: ListingDto): AdminListing {
  return {
    id: dto.id,
    title: dto.title,
    coach: dto.coach,
    coachBlocked: dto.coach_blocked,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    location: dto.location,
    state: dto.state,
    moderationReason: dto.moderation_reason,
    hiddenBy: dto.hidden_by,
    hiddenAt: dto.hidden_at,
    activeBookings: dto.active_bookings,
    hasPhoto: dto.has_photo,
    hasVideo: dto.has_video,
    createdAt: dto.created_at,
    description: dto.description,
    openComplaints: dto.open_complaints,
  };
}

export async function listAdminListings(query: { q: string; state: ListingState | ""; limit: number; offset: number }): Promise<Page<AdminListing>> {
  const dto = await apiRequest<{ total: number; limit: number; offset: number; items: ListingDto[] }>(
    `/api/admin/listings${queryString({ q: query.q.trim() || undefined, state: query.state, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(mapListing) };
}

export async function getAdminListing(id: string): Promise<AdminListing> {
  return mapListing(await apiRequest<ListingDto>(`/api/admin/listings/${id}`, QUIET));
}

export async function hideAdminListing(id: string, reason: string): Promise<AdminListing> {
  return mapListing(await apiRequest<ListingDto>(`/api/admin/listings/${id}/hide`, { method: "POST", successMessage: "Объявление скрыто", body: { reason } }));
}

export async function restoreAdminListing(id: string, reason: string): Promise<AdminListing> {
  return mapListing(await apiRequest<ListingDto>(`/api/admin/listings/${id}/restore`, { method: "POST", successMessage: "Объявление восстановлено", body: { reason } }));
}

export async function deleteAdminListing(id: string, reason: string): Promise<AdminListing> {
  return mapListing(
    await apiRequest<ListingDto>(`/api/admin/listings/${id}/delete`, { method: "POST", silent: true, body: { reason, confirm: true } }),
  );
}

// --- complaints ---------------------------------------------------------------------------------------------------------

export type ComplaintStatus = "new" | "in_progress" | "resolved" | "rejected";
export type ComplaintReason = "inappropriate" | "fraud" | "spam" | "false_info" | "other";
export type ComplaintTarget = "user" | "listing" | "media";

export interface AdminComplaint {
  id: string;
  status: ComplaintStatus;
  reason: ComplaintReason;
  comment: string | null;
  createdAt: string;
  reporter: Person;
  target: { type: ComplaintTarget; id: string; label: string | null; state: string | null; owner: Person | null };
  otherOpenOnTarget: number;
  handledBy: string | null;
  handledAt: string | null;
  resolution: string | null;
}

interface ComplaintDto {
  id: string;
  status: ComplaintStatus;
  reason: ComplaintReason;
  comment: string | null;
  created_at: string;
  reporter: Person;
  target: { type: ComplaintTarget; id: string; label: string | null; state: string | null; owner: Person | null };
  other_open_on_target: number;
  handled_by: string | null;
  handled_at: string | null;
  resolution: string | null;
}

function mapComplaint(dto: ComplaintDto): AdminComplaint {
  return {
    id: dto.id,
    status: dto.status,
    reason: dto.reason,
    comment: dto.comment,
    createdAt: dto.created_at,
    reporter: dto.reporter,
    target: dto.target,
    otherOpenOnTarget: dto.other_open_on_target,
    handledBy: dto.handled_by,
    handledAt: dto.handled_at,
    resolution: dto.resolution,
  };
}

export async function listAdminComplaints(query: {
  status: ComplaintStatus | "";
  targetType: ComplaintTarget | "";
  reason: ComplaintReason | "";
  q: string;
  limit: number;
  offset: number;
}): Promise<Page<AdminComplaint>> {
  const dto = await apiRequest<{ total: number; limit: number; offset: number; items: ComplaintDto[] }>(
    `/api/admin/complaints${queryString({ status: query.status, target_type: query.targetType, reason: query.reason, q: query.q.trim() || undefined, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return { total: dto.total, limit: dto.limit, offset: dto.offset, items: dto.items.map(mapComplaint) };
}

export async function takeAdminComplaint(id: string): Promise<AdminComplaint> {
  return mapComplaint(await apiRequest<ComplaintDto>(`/api/admin/complaints/${id}/take`, { method: "POST", successMessage: "Жалоба взята в работу" }));
}

export async function resolveAdminComplaint(id: string, status: "resolved" | "rejected", resolution: string): Promise<AdminComplaint> {
  return mapComplaint(
    await apiRequest<ComplaintDto>(`/api/admin/complaints/${id}/resolve`, {
      method: "POST",
      successMessage: status === "resolved" ? "Жалоба решена" : "Жалоба отклонена",
      body: { status, resolution },
    }),
  );
}

/** The public side: any signed-in user can report a profile, a listing or a public photo/video. */
export async function createComplaint(input: {
  targetType: ComplaintTarget;
  targetId: string;
  reason: ComplaintReason;
  comment: string | null;
}): Promise<void> {
  await apiRequest("/api/complaints", {
    method: "POST",
    successMessage: "Жалоба отправлена. Спасибо — мы её рассмотрим.",
    body: { target_type: input.targetType, target_id: input.targetId, reason: input.reason, comment: input.comment },
  });
}

// --- audit trail -----------------------------------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  reason: string | null;
  result: "success" | "denied" | "failed";
  createdAt: string;
  admin: string;
}

export async function listAdminAudit(query: {
  action: string;
  targetType: string;
  result: "success" | "denied" | "failed" | "";
  q: string;
  limit: number;
  offset: number;
}): Promise<Page<AuditEntry>> {
  const dto = await apiRequest<{
    total: number;
    limit: number;
    offset: number;
    items: {
      id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      details: Record<string, unknown> | null;
      reason: string | null;
      result: "success" | "denied" | "failed";
      created_at: string;
      admin: string;
    }[];
  }>(
    `/api/admin/audit${queryString({ action: query.action, target_type: query.targetType, result: query.result, q: query.q.trim() || undefined, limit: query.limit, offset: query.offset })}`,
    QUIET,
  );
  return {
    total: dto.total,
    limit: dto.limit,
    offset: dto.offset,
    items: dto.items.map((e) => ({
      id: e.id,
      action: e.action,
      targetType: e.target_type,
      targetId: e.target_id,
      details: e.details,
      reason: e.reason,
      result: e.result,
      createdAt: e.created_at,
      admin: e.admin,
    })),
  };
}
