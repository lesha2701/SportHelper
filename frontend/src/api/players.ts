import { apiRequest } from "./client";
import { mapPlayerPublicProfileDto, type PlayerPublicProfile, type PlayerPublicProfileDto } from "../types/player";

export async function getPlayerPublicProfile(token: string, playerUserId: string): Promise<PlayerPublicProfile> {
  const dto = await apiRequest<PlayerPublicProfileDto>(`/api/players/${playerUserId}/profile`, { token });
  return mapPlayerPublicProfileDto(dto);
}
