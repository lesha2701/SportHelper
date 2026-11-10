import { apiRequest } from "./client";
import { mapCoachPublicProfileDto, type CoachPublicProfile, type CoachPublicProfileDto } from "@/shared/types/coach";
import {
  mapCoachListingCardDto,
  mapCoachReviewDto,
  type CoachListingCard,
  type CoachListingCardDto,
  type CoachReview,
  type CoachReviewDto,
} from "@/shared/types/coachListing";

export async function getCoachPublicProfile(coachUserId: string): Promise<CoachPublicProfile> {
  const dto = await apiRequest<CoachPublicProfileDto>(`/api/coaches/${coachUserId}/profile`);
  return mapCoachPublicProfileDto(dto);
}

export async function listCoachPublicListings(coachUserId: string): Promise<CoachListingCard[]> {
  const dtos = await apiRequest<CoachListingCardDto[]>(`/api/coaches/${coachUserId}/listings`);
  return dtos.map(mapCoachListingCardDto);
}

export async function listCoachPublicReviews(coachUserId: string): Promise<CoachReview[]> {
  const dtos = await apiRequest<CoachReviewDto[]>(`/api/coaches/${coachUserId}/reviews`);
  return dtos.map(mapCoachReviewDto);
}
