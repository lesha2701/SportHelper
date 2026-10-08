import { apiRequest } from "./client";
import {
  mapPlayerPublicProfileDto,
  mapPlayerReviewsDto,
  type PlayerPublicProfile,
  type PlayerPublicProfileDto,
  type PlayerReviews,
  type PlayerReviewsDto,
} from "../types/player";

export async function getPlayerPublicProfile(token: string, playerUserId: string): Promise<PlayerPublicProfile> {
  const dto = await apiRequest<PlayerPublicProfileDto>(`/api/players/${playerUserId}/profile`, { token });
  return mapPlayerPublicProfileDto(dto);
}

/** What coaches wrote about this player — only readable by a coach who has a booking with them. */
export async function getPlayerReviews(token: string, playerUserId: string): Promise<PlayerReviews> {
  const dto = await apiRequest<PlayerReviewsDto>(`/api/players/${playerUserId}/reviews`, { token, silent: true });
  return mapPlayerReviewsDto(dto);
}
