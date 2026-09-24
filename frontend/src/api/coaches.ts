import { apiRequest } from "./client";
import { mapCoachPublicProfileDto, type CoachPublicProfile, type CoachPublicProfileDto } from "../types/coach";
import {
  mapCoachListingCardDto,
  mapCoachReviewDto,
  type CoachListingCard,
  type CoachListingCardDto,
  type CoachReview,
  type CoachReviewDto,
} from "../types/coachListing";

export async function getCoachPublicProfile(token: string, coachUserId: string): Promise<CoachPublicProfile> {
  const dto = await apiRequest<CoachPublicProfileDto>(`/api/coaches/${coachUserId}/profile`, { token });
  return mapCoachPublicProfileDto(dto);
}

export async function listCoachPublicListings(token: string, coachUserId: string): Promise<CoachListingCard[]> {
  const dtos = await apiRequest<CoachListingCardDto[]>(`/api/coaches/${coachUserId}/listings`, { token });
  return dtos.map(mapCoachListingCardDto);
}

export async function listCoachPublicReviews(token: string, coachUserId: string): Promise<CoachReview[]> {
  const dtos = await apiRequest<CoachReviewDto[]>(`/api/coaches/${coachUserId}/reviews`, { token });
  return dtos.map(mapCoachReviewDto);
}
