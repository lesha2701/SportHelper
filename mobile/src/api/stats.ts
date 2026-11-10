import { apiRequest } from "./client";
import { mapPlayerStatsDto, mapTeamStatsDto, type PlayerStats, type PlayerStatsDto, type TeamStats, type TeamStatsDto } from "@/shared/types/stats";

export async function getTeamStats(teamId: string): Promise<TeamStats> {
  const dto = await apiRequest<TeamStatsDto>(`/api/teams/${teamId}/stats`);
  return mapTeamStatsDto(dto);
}

export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  const dto = await apiRequest<PlayerStatsDto>(`/api/players/${userId}/stats`);
  return mapPlayerStatsDto(dto);
}
