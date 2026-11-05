// frontend/src/api/coachListings.ts
import { apiRequest, apiUpload, type UploadFile } from "./client";
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
} from "@/shared/types/coachListing";

export async function createListing(input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>("/api/coach-listings", { method: "POST", successMessage: "Объявление создано", body: input });
  return mapCoachListingDto(dto);
}

export async function listMyListings(): Promise<CoachListing[]> {
  const dtos = await apiRequest<CoachListingDto[]>("/api/coach-listings/me");
  return dtos.map(mapCoachListingDto);
}

export async function updateListing(listingId: string, input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>(`/api/coach-listings/${listingId}`, { method: "PUT", successMessage: "Объявление сохранено", body: input });
  return mapCoachListingDto(dto);
}

export async function deleteListing(listingId: string): Promise<void> {
  await apiRequest(`/api/coach-listings/${listingId}`, { method: "DELETE", successMessage: "Объявление удалено" });
}

export async function getListingAvailability(listingId: string): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`);
  return dtos.map(mapAvailabilityWindowDto);
}

export async function replaceListingAvailability(
  listingId: string,
  windows: AvailabilityWindowInput[],
): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`, {
    method: "PUT", successMessage: "Расписание сохранено",
    body: windows,
  });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function uploadListingPhoto(listingId: string, file: UploadFile): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/photo`, { formData });
  return mapCoachListingDto(dto);
}

export async function uploadListingVideo(listingId: string, file: UploadFile): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/video`, { formData });
  return mapCoachListingDto(dto);
}

function filtersToQuery(filters: CoachListingFilters): string {
  const params = new URLSearchParams();
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.location) params.set("location", filters.location);
  if (filters.min_price !== undefined) params.set("min_price", String(filters.min_price));
  if (filters.max_price !== undefined) params.set("max_price", String(filters.max_price));
  if (filters.min_rating !== undefined) params.set("min_rating", String(filters.min_rating));
  if (filters.format) params.set("format", filters.format);
  if (filters.min_experience_years !== undefined) params.set("min_experience_years", String(filters.min_experience_years));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listListings(filters: CoachListingFilters = {}): Promise<CoachListingCard[]> {
  const dtos = await apiRequest<CoachListingCardDto[]>(`/api/coach-listings${filtersToQuery(filters)}`);
  return dtos.map(mapCoachListingCardDto);
}

export async function getListingProfile(listingId: string): Promise<CoachListingProfile> {
  const dto = await apiRequest<CoachListingProfileDto>(`/api/coach-listings/${listingId}`);
  return mapCoachListingProfileDto(dto);
}

export async function getListingOpenSlots(
  listingId: string,
  fromDate: string,
  toDate: string,
): Promise<OpenSlot[]> {
  const dtos = await apiRequest<OpenSlotDto[]>(
    `/api/coach-listings/${listingId}/slots?from_date=${fromDate}&to_date=${toDate}`,
    {},
  );
  return dtos.map(mapOpenSlotDto);
}
