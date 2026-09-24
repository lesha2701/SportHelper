// frontend/src/types/player.ts
import type { SkillLevel } from "./profile";

export interface PlayerPublicProfileDto {
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
  photo_url: string | null;
}

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
  photoUrl: string | null;
}

export function mapPlayerPublicProfileDto(dto: PlayerPublicProfileDto): PlayerPublicProfile {
  return {
    userId: dto.user_id,
    fullName: dto.full_name,
    age: dto.age,
    heightCm: dto.height_cm,
    weightKg: dto.weight_kg,
    sport: dto.sport,
    position: dto.position,
    level: dto.level,
    goals: dto.goals,
    loadRestrictions: dto.load_restrictions,
    avatarFileId: dto.avatar_file_id,
    photoUrl: dto.photo_url,
  };
}
