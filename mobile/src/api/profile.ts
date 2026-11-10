import {
  mapProfileMeDto,
  type CoachProfileInput,
  type PlayerProfileInput,
  type ProfileMe,
  type ProfileMeDto,
} from "@/shared/types/profile";
import type { NotificationPreference } from "@/shared/types/notification";
import { apiRequest } from "./client";

export async function fetchProfileMe(): Promise<ProfileMe> {
  return mapProfileMeDto(await apiRequest<ProfileMeDto>("/api/profile/me"));
}

/** Admins only (the server refuses others): switch the account between its player and coach profile. */
export async function switchActiveMode(mode: "player" | "coach"): Promise<ProfileMe> {
  return mapProfileMeDto(await apiRequest<ProfileMeDto>("/api/profile/active-mode", { method: "POST", body: { mode } }));
}

export async function savePlayerProfile(input: PlayerProfileInput): Promise<void> {
  await apiRequest("/api/profile/player", { method: "PUT", body: input });
}

export async function saveCoachProfile(input: CoachProfileInput): Promise<void> {
  await apiRequest("/api/profile/coach", { method: "PUT", body: input });
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences");
}

export async function setNotificationPreference(preference: NotificationPreference): Promise<NotificationPreference[]> {
  return apiRequest<NotificationPreference[]>("/api/notifications/preferences", { method: "PUT", body: { preferences: [preference] } });
}
