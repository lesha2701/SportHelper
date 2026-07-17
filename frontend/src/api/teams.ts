import { apiRequest, apiUpload } from "./client";
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
} from "../types/team";
import { mapPlayerDto, type PlayerProfile, type PlayerProfileDto } from "../types/profile";

export async function listMyTeams(token: string): Promise<Team[]> {
  const dtos = await apiRequest<TeamDto[]>("/api/teams/mine", { token });
  return dtos.map(mapTeamDto);
}

export async function createTeam(token: string, input: TeamInput): Promise<Team> {
  const dto = await apiRequest<TeamDto>("/api/teams", { method: "POST", token, body: input });
  return mapTeamDto(dto);
}

export async function getTeam(token: string, teamId: string): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/teams/${teamId}`, { token });
  return mapTeamDto(dto);
}

export async function updateTeam(token: string, teamId: string, input: TeamInput): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/teams/${teamId}`, { method: "PUT", token, body: input });
  return mapTeamDto(dto);
}

export async function uploadTeamLogo(token: string, teamId: string, file: File): Promise<Team> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<TeamDto>(`/api/teams/${teamId}/logo`, { token, formData });
  return mapTeamDto(dto);
}

export async function listMembers(token: string, teamId: string): Promise<TeamMember[]> {
  const dtos = await apiRequest<TeamMemberDto[]>(`/api/teams/${teamId}/members`, { token });
  return dtos.map(mapTeamMemberDto);
}

export async function getMemberPlayerProfile(token: string, teamId: string, userId: string): Promise<PlayerProfile> {
  const dto = await apiRequest<PlayerProfileDto>(`/api/teams/${teamId}/members/${userId}/profile`, { token });
  return mapPlayerDto(dto);
}

export async function updateMember(
  token: string,
  teamId: string,
  userId: string,
  input: { role?: TeamRole | null; position?: string | null },
): Promise<TeamMember> {
  const dto = await apiRequest<TeamMemberDto>(`/api/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    token,
    body: input,
  });
  return mapTeamMemberDto(dto);
}

export async function removeMember(token: string, teamId: string, userId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE", token });
}

export async function blockMember(token: string, teamId: string, userId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/members/${userId}/block`, { method: "POST", token });
}

export async function leaveTeam(token: string, teamId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/leave`, { method: "POST", token });
}

export async function transferOwnership(
  token: string,
  teamId: string,
  toUserId: string,
  confirmationPhrase: string,
): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/transfer-ownership`, {
    method: "POST",
    token,
    body: { to_user_id: toUserId, confirmation_phrase: confirmationPhrase },
  });
}

export async function createInvite(token: string, teamId: string, kind: InviteKind): Promise<Invite> {
  const dto = await apiRequest<InviteDto>(`/api/teams/${teamId}/invites`, {
    method: "POST",
    token,
    body: { kind },
  });
  return mapInviteDto(dto);
}

export async function listInvites(token: string, teamId: string): Promise<Invite[]> {
  const dtos = await apiRequest<InviteDto[]>(`/api/teams/${teamId}/invites`, { token });
  return dtos.map(mapInviteDto);
}

export async function listApplications(token: string, teamId: string): Promise<JoinRequest[]> {
  const dtos = await apiRequest<JoinRequestDto[]>(`/api/teams/${teamId}/applications`, { token });
  return dtos.map(mapJoinRequestDto);
}

export async function acceptApplication(token: string, teamId: string, requestId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/applications/${requestId}/accept`, { method: "POST", token });
}

export async function rejectApplication(token: string, teamId: string, requestId: string): Promise<void> {
  await apiRequest(`/api/teams/${teamId}/applications/${requestId}/reject`, { method: "POST", token });
}

export async function previewInvite(token: string, inviteToken: string): Promise<Team> {
  const dto = await apiRequest<TeamDto>(`/api/invites/${inviteToken}`, { token });
  return mapTeamDto(dto);
}

export interface ApplyResult {
  status: "pending" | "joined";
  team: Team;
}

export async function applyViaInvite(token: string, inviteToken: string): Promise<ApplyResult> {
  const dto = await apiRequest<{ status: "pending" | "joined"; team: TeamDto }>(
    `/api/invites/${inviteToken}/apply`,
    { method: "POST", token },
  );
  return { status: dto.status, team: mapTeamDto(dto.team) };
}
