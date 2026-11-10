export type PlanSection = "warmup" | "main" | "game" | "cooldown";

export const PLAN_SECTION_LABELS: Record<PlanSection, string> = {
  warmup: "Разминка",
  main: "Основная часть",
  game: "Игровая часть",
  cooldown: "Заминка",
};

export const PLAN_SECTIONS: PlanSection[] = ["warmup", "main", "game", "cooldown"];

export interface PlanExercise {
  id: string;
  planId: string;
  exerciseId: string;
  exerciseName: string | null;
  section: PlanSection;
  orderIndex: number;
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
}

export interface Plan {
  id: string;
  ownerId: string;
  sport: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  equipment: string | null;
  comment: string | null;
  exercises: PlanExercise[];
  sharedTeamIds: string[];
}

export interface PlanInput {
  sport: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  equipment: string | null;
  comment: string | null;
}

export interface PlanExerciseInput {
  exercise_id: string;
  section: PlanSection;
  order_index: number;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

export interface PlanExerciseDto {
  id: string;
  plan_id: string;
  exercise_id: string;
  exercise_name: string | null;
  section: PlanSection;
  order_index: number;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

export interface PlanDto {
  id: string;
  owner_id: string;
  sport: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  equipment: string | null;
  comment: string | null;
  exercises: PlanExerciseDto[];
  shared_team_ids: string[];
}

function mapPlanExerciseDto(dto: PlanExerciseDto): PlanExercise {
  return {
    id: dto.id,
    planId: dto.plan_id,
    exerciseId: dto.exercise_id,
    exerciseName: dto.exercise_name,
    section: dto.section,
    orderIndex: dto.order_index,
    sets: dto.sets,
    reps: dto.reps,
    durationSeconds: dto.duration_seconds,
    restSeconds: dto.rest_seconds,
    notes: dto.notes,
  };
}

export function mapPlanDto(dto: PlanDto): Plan {
  return {
    id: dto.id,
    ownerId: dto.owner_id,
    sport: dto.sport,
    name: dto.name,
    description: dto.description,
    durationMinutes: dto.duration_minutes,
    equipment: dto.equipment,
    comment: dto.comment,
    exercises: dto.exercises.map(mapPlanExerciseDto),
    sharedTeamIds: dto.shared_team_ids,
  };
}
