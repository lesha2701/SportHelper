import { apiRequest } from "./client";
import {
  mapMatchDto,
  type Match,
  type MatchCreateInput,
  type MatchDto,
  type MatchResultInput,
  type MatchRosterInput,
  type MatchUpdateInput,
} from "@/shared/types/match";

export async function createMatch(teamId: string, input: MatchCreateInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/teams/${teamId}/matches`, { method: "POST", silent: true, body: input });
  return mapMatchDto(dto);
}

export async function listTeamMatches(teamId: string): Promise<Match[]> {
  const dtos = await apiRequest<MatchDto[]>(`/api/teams/${teamId}/matches`);
  return dtos.map(mapMatchDto);
}

export async function getMatch(matchId: string): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}`);
  return mapMatchDto(dto);
}

export async function updateMatch(matchId: string, input: MatchUpdateInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}`, { method: "PUT", successMessage: "Матч сохранён", body: input });
  return mapMatchDto(dto);
}

export async function deleteMatch(matchId: string): Promise<void> {
  await apiRequest(`/api/matches/${matchId}`, { method: "DELETE", successMessage: "Матч удалён" });
}

export async function setMatchRoster(matchId: string, input: MatchRosterInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}/roster`, { method: "PUT", successMessage: "Состав сохранён", body: input });
  return mapMatchDto(dto);
}

export async function setMatchResult(matchId: string, input: MatchResultInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}/result`, { method: "POST", silent: true, body: input });
  return mapMatchDto(dto);
}
