// frontend/src/api/coaches.ts
import { apiRequest } from "./client";
import {
  mapAvailabilityWindowDto,
  mapCoachCardDto,
  mapCoachMarketplaceSettingsDto,
  mapCoachPublicProfileDto,
  mapOpenSlotDto,
  type AvailabilityWindow,
  type AvailabilityWindowDto,
  type AvailabilityWindowInput,
  type CoachCard,
  type CoachCardDto,
  type CoachListFilters,
  type CoachMarketplaceSettings,
  type CoachMarketplaceSettingsDto,
  type CoachMarketplaceSettingsInput,
  type CoachPublicProfile,
  type CoachPublicProfileDto,
  type OpenSlot,
  type OpenSlotDto,
} from "../types/coach";

export async function getMyMarketplaceSettings(token: string): Promise<CoachMarketplaceSettings> {
  const dto = await apiRequest<CoachMarketplaceSettingsDto>("/api/coaches/me/marketplace-settings", { token });
  return mapCoachMarketplaceSettingsDto(dto);
}

export async function updateMyMarketplaceSettings(
  token: string,
  input: CoachMarketplaceSettingsInput,
): Promise<CoachMarketplaceSettings> {
  const dto = await apiRequest<CoachMarketplaceSettingsDto>("/api/coaches/me/marketplace-settings", {
    method: "PUT",
    token,
    body: input,
  });
  return mapCoachMarketplaceSettingsDto(dto);
}

export async function getMyAvailability(token: string): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>("/api/coaches/me/availability", { token });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function replaceMyAvailability(token: string, windows: AvailabilityWindowInput[]): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>("/api/coaches/me/availability", {
    method: "PUT",
    token,
    body: windows,
  });
  return dtos.map(mapAvailabilityWindowDto);
}

function filtersToQuery(filters: CoachListFilters): string {
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

export async function listCoaches(token: string, filters: CoachListFilters = {}): Promise<CoachCard[]> {
  const dtos = await apiRequest<CoachCardDto[]>(`/api/coaches${filtersToQuery(filters)}`, { token });
  return dtos.map(mapCoachCardDto);
}

export async function getCoachPublicProfile(token: string, coachUserId: string): Promise<CoachPublicProfile> {
  const dto = await apiRequest<CoachPublicProfileDto>(`/api/coaches/${coachUserId}`, { token });
  return mapCoachPublicProfileDto(dto);
}

export async function getCoachOpenSlots(
  token: string,
  coachUserId: string,
  fromDate: string,
  toDate: string,
): Promise<OpenSlot[]> {
  const dtos = await apiRequest<OpenSlotDto[]>(
    `/api/coaches/${coachUserId}/slots?from_date=${fromDate}&to_date=${toDate}`,
    { token },
  );
  return dtos.map(mapOpenSlotDto);
}
