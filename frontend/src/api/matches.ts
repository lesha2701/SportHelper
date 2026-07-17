import { apiRequest } from "./client";
import {
  mapMatchDto,
  type Match,
  type MatchCreateInput,
  type MatchDto,
  type MatchResultInput,
  type MatchRosterInput,
  type MatchUpdateInput,
} from "../types/match";

export async function createMatch(token: string, teamId: string, input: MatchCreateInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/teams/${teamId}/matches`, { method: "POST", token, body: input });
  return mapMatchDto(dto);
}

export async function listTeamMatches(token: string, teamId: string): Promise<Match[]> {
  const dtos = await apiRequest<MatchDto[]>(`/api/teams/${teamId}/matches`, { token });
  return dtos.map(mapMatchDto);
}

export async function getMatch(token: string, matchId: string): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}`, { token });
  return mapMatchDto(dto);
}

export async function updateMatch(token: string, matchId: string, input: MatchUpdateInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}`, { method: "PUT", token, body: input });
  return mapMatchDto(dto);
}

export async function deleteMatch(token: string, matchId: string): Promise<void> {
  await apiRequest(`/api/matches/${matchId}`, { method: "DELETE", token });
}

export async function setMatchRoster(token: string, matchId: string, input: MatchRosterInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}/roster`, { method: "PUT", token, body: input });
  return mapMatchDto(dto);
}

export async function setMatchResult(token: string, matchId: string, input: MatchResultInput): Promise<Match> {
  const dto = await apiRequest<MatchDto>(`/api/matches/${matchId}/result`, { method: "POST", token, body: input });
  return mapMatchDto(dto);
}
