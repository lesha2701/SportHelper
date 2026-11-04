import { apiRequest, apiUpload, type UploadFile } from "./client";
import {
  mapInviteDto,
  mapJoinRequestDto,
  mapTeamDto,
  mapTeamMemberDto,
  type Invite,
  type InviteDto,
  type InviteKind,
  type JoinRequest,
  type JoinRequestDto,
  type Team,
  type TeamDto,
  type TeamInput,
  type TeamMember,
  type TeamMemberDto,
  type TeamRole,
} from "@/shared/types/team";
import { mapPlayerDto, type PlayerProfile, type PlayerProfileDto } from "@/shared/types/profile";

export async function listMyTeams(): Promise<Team[]> {
  const dtos = await apiRequest<TeamDto[]>("/api/teams/mine");
  return dtos.map(mapTeamDto);
}

export async function createTeam(input: TeamInput): Promise<Team> {
  const dto = await apiRequest<TeamDto>("/api/teams", { method: "POST", successMessage: "Команда создана", body: input });
  return mapTeamDto(dto);
}

export async function getTeam(teamId: string): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/teams/${teamId}`);
  return mapTeamDto(dto);
}

export async function updateTeam(teamId: string, input: TeamInput): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/teams/${teamId}`, { method: "PUT", successMessage: "Команда сохранена", body: input });
  return mapTeamDto(dto);
}

export async function uploadTeamLogo(teamId: string, file: UploadFile): Promise<Team> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<TeamDto>(`/api/teams/${teamId}/logo`, { formData, successMessage: "Логотип обновлён" });
  return mapTeamDto(dto);
}

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const dtos = await apiRequest<TeamMemberDto[]>(`/api/teams/${teamId}/members`);
  return dtos.map(mapTeamMemberDto);
}

export async function getMemberPlayerProfile(teamId: string, userId: string): Promise<PlayerProfile> {
  const dto = await apiRequest<PlayerProfileDto>(`/api/teams/${teamId}/members/${userId}/profile`);
  return mapPlayerDto(dto);
}

export async function updateMember(
  teamId: string,
  userId: string,
  input: { role?: TeamRole | null; position?: string | null },
): Promise<TeamMember> {
  const dto = await apiRequest<TeamMemberDto>(`/api/teams/${teamId}/members/${userId}`, {
    method: "PATCH", successMessage: "Данные участника сохранены",
    body: input,
  });
  return mapTeamMemberDto(dto);
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE", successMessage: "Участник удалён" });
}

export async function blockMember(teamId: string, userId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/members/${userId}/block`, { method: "POST", successMessage: "Участник заблокирован" });
}

export async function leaveTeam(teamId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/leave`, { method: "POST", successMessage: "Вы вышли из команды" });
}

export async function transferOwnership(
  teamId: string,
  toUserId: string,
  confirmationPhrase: string,
): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/transfer-ownership`, {
    method: "POST", successMessage: "Права на команду переданы",
    body: { to_user_id: toUserId, confirmation_phrase: confirmationPhrase },
  });
}

export async function createInvite(teamId: string, kind: InviteKind): Promise<Invite> {
  const dto = await apiRequest<InviteDto>(`/api/teams/${teamId}/invites`, {
    method: "POST", successMessage: "Приглашение создано",
    body: { kind },
  });
  return mapInviteDto(dto);
}

export async function listInvites(teamId: string): Promise<Invite[]> {
  const dtos = await apiRequest<InviteDto[]>(`/api/teams/${teamId}/invites`);
  return dtos.map(mapInviteDto);
}

export async function listApplications(teamId: string): Promise<JoinRequest[]> {
  const dtos = await apiRequest<JoinRequestDto[]>(`/api/teams/${teamId}/applications`);
  return dtos.map(mapJoinRequestDto);
}

export async function acceptApplication(teamId: string, requestId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/applications/${requestId}/accept`, { method: "POST", silent: true });
}

export async function rejectApplication(teamId: string, requestId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/applications/${requestId}/reject`, { method: "POST", successMessage: "Заявка отклонена" });
}

export async function previewInvite(inviteToken: string): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/invites/${inviteToken}`);
  return mapTeamDto(dto);
}

export interface ApplyResult {
  status: "pending" | "joined";
  team: Team;
}

export async function applyViaInvite(inviteToken: string): Promise<ApplyResult> {
  const dto = await apiRequest<{ status: "pending" | "joined"; team: TeamDto }>(
    `/api/invites/${inviteToken}/apply`,
    { method: "POST", successMessage: "Заявка на вступление отправлена" },
  );
  return { status: dto.status, team: mapTeamDto(dto.team) };
}
