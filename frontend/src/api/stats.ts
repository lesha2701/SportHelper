import { apiRequest } from "./client";
import { mapPlayerStatsDto, mapTeamStatsDto, type PlayerStats, type PlayerStatsDto, type TeamStats, type TeamStatsDto } from "../types/stats";

export async function getTeamStats(token: string, teamId: string): Promise<TeamStats> {
  const dto = await apiRequest<TeamStatsDto>(`/api/teams/${teamId}/stats`, { token });
  return mapTeamStatsDto(dto);
}

export async function getPlayerStats(token: string, userId: string): Promise<PlayerStats> {
  const dto = await apiRequest<PlayerStatsDto>(`/api/players/${userId}/stats`, { token });
  return mapPlayerStatsDto(dto);
}
