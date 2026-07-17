export type SkillLevel = "beginner" | "amateur" | "intermediate" | "advanced" | "professional";
export type ActiveMode = "player" | "coach";

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: "Новичок",
  amateur: "Любитель",
  intermediate: "Средний",
  advanced: "Продвинутый",
  professional: "Профессионал",
};

export const COMMON_SPORTS = [
  "Баскетбол",
  "Футбол",
  "Волейбол",
  "Хоккей",
  "Гандбол",
  "Футзал",
  "Регби",
];

export interface PlayerProfile {
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
}

export interface CoachProfile {
  userId: string;
  fullName: string;
  sport: string;
  experienceYears: number | null;
  specialization: string | null;
  description: string | null;
}

export interface ProfileMe {
  activeMode: ActiveMode | null;
  player: PlayerProfile | null;
  coach: CoachProfile | null;
}

export interface PlayerProfileDto {
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
}

interface CoachProfileDto {
  user_id: string;
  full_name: string;
  sport: string;
  experience_years: number | null;
  specialization: string | null;
  description: string | null;
}

export interface ProfileMeDto {
  active_mode: ActiveMode | null;
  player: PlayerProfileDto | null;
  coach: CoachProfileDto | null;
}

export function mapPlayerDto(dto: PlayerProfileDto): PlayerProfile {
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
  };
}

function mapCoachDto(dto: CoachProfileDto): CoachProfile {
  return {
    userId: dto.user_id,
    fullName: dto.full_name,
    sport: dto.sport,
    experienceYears: dto.experience_years,
    specialization: dto.specialization,
    description: dto.description,
  };
}

export function mapProfileMeDto(dto: ProfileMeDto): ProfileMe {
  return {
    activeMode: dto.active_mode,
    player: dto.player ? mapPlayerDto(dto.player) : null,
    coach: dto.coach ? mapCoachDto(dto.coach) : null,
  };
}

export interface PlayerProfileInput {
  full_name: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  sport: string;
  position: string | null;
  level: SkillLevel | null;
  goals: string | null;
  load_restrictions: string | null;
}

export interface CoachProfileInput {
  full_name: string;
  sport: string;
  experience_years: number | null;
  specialization: string | null;
  description: string | null;
}
