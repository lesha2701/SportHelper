import { apiRequest } from "./client";
import {
  mapProfileMeDto,
  type ActiveMode,
  type CoachProfileInput,
  type PlayerProfileInput,
  type ProfileMe,
  type ProfileMeDto,
} from "../types/profile";

export async function fetchProfileMe(token: string): Promise<ProfileMe> {
  const dto = await apiRequest<ProfileMeDto>("/api/profile/me", { token });
  return mapProfileMeDto(dto);
}

export async function savePlayerProfile(token: string, input: PlayerProfileInput): Promise<void> {
  await apiRequest("/api/profile/player", { method: "PUT", token, body: input });
}

export async function saveCoachProfile(token: string, input: CoachProfileInput): Promise<void> {
  await apiRequest("/api/profile/coach", { method: "PUT", token, body: input });
}

export async function switchActiveMode(token: string, mode: ActiveMode): Promise<ProfileMe> {
  const dto = await apiRequest<ProfileMeDto>("/api/profile/active-mode", {
    method: "POST",
    token,
    body: { mode },
  });
  return mapProfileMeDto(dto);
}
