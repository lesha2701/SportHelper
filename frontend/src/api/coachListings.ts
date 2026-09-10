// frontend/src/api/coachListings.ts
import { apiRequest, apiUpload } from "./client";
import {
  mapAvailabilityWindowDto,
  mapCoachListingCardDto,
  mapCoachListingDto,
  mapCoachListingProfileDto,
  mapOpenSlotDto,
  type AvailabilityWindow,
  type AvailabilityWindowDto,
  type AvailabilityWindowInput,
  type CoachListing,
  type CoachListingCard,
  type CoachListingCardDto,
  type CoachListingDto,
  type CoachListingFilters,
  type CoachListingInput,
  type CoachListingProfile,
  type CoachListingProfileDto,
  type OpenSlot,
  type OpenSlotDto,
} from "../types/coachListing";

export async function createListing(token: string, input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>("/api/coach-listings", { method: "POST", token, body: input });
  return mapCoachListingDto(dto);
}

export async function listMyListings(token: string): Promise<CoachListing[]> {
  const dtos = await apiRequest<CoachListingDto[]>("/api/coach-listings/me", { token });
  return dtos.map(mapCoachListingDto);
}

export async function updateListing(token: string, listingId: string, input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>(`/api/coach-listings/${listingId}`, { method: "PUT", token, body: input });
  return mapCoachListingDto(dto);
}

export async function deleteListing(token: string, listingId: string): Promise<void> {
  await apiRequest(`/api/coach-listings/${listingId}`, { method: "DELETE", token });
}

export async function getListingAvailability(token: string, listingId: string): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`, { token });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function replaceListingAvailability(
  token: string,
  listingId: string,
  windows: AvailabilityWindowInput[],
): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`, {
    method: "PUT",
    token,
    body: windows,
  });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function uploadListingPhoto(token: string, listingId: string, file: File): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/photo`, { token, formData });
  return mapCoachListingDto(dto);
}

export async function uploadListingVideo(token: string, listingId: string, file: File): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/video`, { token, formData });
  return mapCoachListingDto(dto);
}

function filtersToQuery(filters: CoachListingFilters): string {
  const params = new URLSearchParams();
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.location) params.set("location", filters.location);
  if (filters.max_price !== undefined) params.set("max_price", String(filters.max_price));
  if (filters.min_rating !== undefined) params.set("min_rating", String(filters.min_rating));
  if (filters.format) params.set("format", filters.format);
  if (filters.min_experience_years !== undefined) params.set("min_experience_years", String(filters.min_experience_years));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listListings(token: string, filters: CoachListingFilters = {}): Promise<CoachListingCard[]> {
  const dtos = await apiRequest<CoachListingCardDto[]>(`/api/coach-listings${filtersToQuery(filters)}`, { token });
  return dtos.map(mapCoachListingCardDto);
}

export async function getListingProfile(token: string, listingId: string): Promise<CoachListingProfile> {
  const dto = await apiRequest<CoachListingProfileDto>(`/api/coach-listings/${listingId}`, { token });
  return mapCoachListingProfileDto(dto);
}

export async function getListingOpenSlots(
  token: string,
  listingId: string,
  fromDate: string,
  toDate: string,
): Promise<OpenSlot[]> {
  const dtos = await apiRequest<OpenSlotDto[]>(
    `/api/coach-listings/${listingId}/slots?from_date=${fromDate}&to_date=${toDate}`,
    { token },
  );
  return dtos.map(mapOpenSlotDto);
}
