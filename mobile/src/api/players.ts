// frontend/src/api/players.ts
import type { SkillLevel } from "@/shared/types/profile";
import { apiRequest } from "./client";

export interface PlayerPublicProfile {
  userId: string;
  fullName: string;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  sport: string;
  position: string | null;
  level: SkillLevel | null;
  goals: string | null;
  loadRestrictions: string | null;
  avatarFileId: string | null;
}

interface PlayerPublicProfileDto {
  user_id: string;
  full_name: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  sport: string;
  position: string | null;
  level: SkillLevel | null;
  goals: string | null;
  load_restrictions: string | null;
  avatar_file_id: string | null;
}

export interface PlayerReviews {
  average: number | null;
  count: number;
  reviews: { id: string; coachName: string; rating: number; text: string | null; createdAt: string }[];
}

interface PlayerReviewsDto {
  average: number | null;
  count: number;
  reviews: { id: string; coach_name: string; rating: number; text: string | null; created_at: string }[];
}

/** A player's profile as a coach with a booking from them sees it. */
export async function getPlayerPublicProfile(playerUserId: string): Promise<PlayerPublicProfile> {
  const d = await apiRequest<PlayerPublicProfileDto>(`/api/players/${playerUserId}/profile`);
  return {
    userId: d.user_id,
    fullName: d.full_name,
    age: d.age,
    heightCm: d.height_cm,
    weightKg: d.weight_kg,
    sport: d.sport,
    position: d.position,
    level: d.level,
    goals: d.goals,
    loadRestrictions: d.load_restrictions,
    avatarFileId: d.avatar_file_id,
  };
}

/** What coaches wrote about this player — only readable by a coach who has a booking with them. */
export async function getPlayerReviews(playerUserId: string): Promise<PlayerReviews> {
  const d = await apiRequest<PlayerReviewsDto>(`/api/players/${playerUserId}/reviews`);
  return {
    average: d.average,
    count: d.count,
    reviews: d.reviews.map((r) => ({ id: r.id, coachName: r.coach_name, rating: r.rating, text: r.text, createdAt: r.created_at })),
  };
}
