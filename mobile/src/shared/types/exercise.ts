import type { SkillLevel } from "./profile";

export interface Exercise {
  id: string;
  ownerId: string;
  sport: string;
  name: string;
  description: string | null;
  goal: string | null;
  photoFileId: string | null;
  videoFileId: string | null;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  equipment: string | null;
  difficulty: SkillLevel | null;
  technique: string | null;
  commonMistakes: string | null;
  warnings: string | null;
  coachComment: string | null;
  sharedTeamIds: string[];
}

export interface ExerciseInput {
  sport: string;
  name: string;
  description: string | null;
  goal: string | null;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  equipment: string | null;
  difficulty: SkillLevel | null;
  technique: string | null;
  common_mistakes: string | null;
  warnings: string | null;
  coach_comment: string | null;
}

export interface ExerciseDto {
  id: string;
  owner_id: string;
  sport: string;
  name: string;
  description: string | null;
  goal: string | null;
  photo_file_id: string | null;
  video_file_id: string | null;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  equipment: string | null;
  difficulty: SkillLevel | null;
  technique: string | null;
  common_mistakes: string | null;
  warnings: string | null;
  coach_comment: string | null;
  shared_team_ids: string[];
}

export function mapExerciseDto(dto: ExerciseDto): Exercise {
  return {
    id: dto.id,
    ownerId: dto.owner_id,
    sport: dto.sport,
    name: dto.name,
    description: dto.description,
    goal: dto.goal,
    photoFileId: dto.photo_file_id,
    videoFileId: dto.video_file_id,
    sets: dto.sets,
    reps: dto.reps,
    durationSeconds: dto.duration_seconds,
    restSeconds: dto.rest_seconds,
    equipment: dto.equipment,
    difficulty: dto.difficulty,
    technique: dto.technique,
    commonMistakes: dto.common_mistakes,
    warnings: dto.warnings,
    coachComment: dto.coach_comment,
    sharedTeamIds: dto.shared_team_ids,
  };
}
