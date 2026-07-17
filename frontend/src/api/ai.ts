import { apiRequest } from "./client";
import type { TaskTargetType } from "../types/task";

export interface TrainingPlanDraftInput {
  goals: string;
  team_id?: string | null;
  sport?: string | null;
  age_category?: string | null;
  level?: string | null;
  player_count?: number | null;
  duration_minutes?: number | null;
  equipment?: string | null;
}

export interface TrainingPlanDraft {
  name: string;
  sport: string;
  description: string;
  durationMinutes: number | null;
  equipment: string | null;
  comment: string | null;
}

interface TrainingPlanDraftDto {
  name: string;
  sport: string;
  description: string;
  duration_minutes: number | null;
  equipment: string | null;
  comment: string | null;
}

function mapTrainingPlanDraftDto(dto: TrainingPlanDraftDto): TrainingPlanDraft {
  return {
    name: dto.name,
    sport: dto.sport,
    description: dto.description,
    durationMinutes: dto.duration_minutes,
    equipment: dto.equipment,
    comment: dto.comment,
  };
}

export async function createTrainingPlanDraft(token: string, input: TrainingPlanDraftInput): Promise<TrainingPlanDraft> {
  const dto = await apiRequest<TrainingPlanDraftDto>("/api/ai/training-plan-draft", { method: "POST", token, body: input });
  return mapTrainingPlanDraftDto(dto);
}

export interface TaskDraftInput {
  goal: string;
  target_type_hint?: string | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  metricName: string | null;
  metricUnit: string | null;
  metricTarget: number | null;
  requireComment: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
  requireSetsReps: boolean;
  requireDuration: boolean;
  requireMetricValue: boolean;
  requireDifficulty: boolean;
  requireWellbeing: boolean;
  targetType: TaskTargetType;
  targetPosition: string | null;
}

interface TaskDraftDto {
  title: string;
  description: string;
  metric_name: string | null;
  metric_unit: string | null;
  metric_target: number | null;
  require_comment: boolean;
  require_photo: boolean;
  require_video: boolean;
  require_sets_reps: boolean;
  require_duration: boolean;
  require_metric_value: boolean;
  require_difficulty: boolean;
  require_wellbeing: boolean;
  target_type: TaskTargetType;
  target_position: string | null;
}

function mapTaskDraftDto(dto: TaskDraftDto): TaskDraft {
  return {
    title: dto.title,
    description: dto.description,
    metricName: dto.metric_name,
    metricUnit: dto.metric_unit,
    metricTarget: dto.metric_target,
    requireComment: dto.require_comment,
    requirePhoto: dto.require_photo,
    requireVideo: dto.require_video,
    requireSetsReps: dto.require_sets_reps,
    requireDuration: dto.require_duration,
    requireMetricValue: dto.require_metric_value,
    requireDifficulty: dto.require_difficulty,
    requireWellbeing: dto.require_wellbeing,
    targetType: dto.target_type,
    targetPosition: dto.target_position,
  };
}

export async function createTaskDraft(token: string, teamId: string, input: TaskDraftInput): Promise<TaskDraft> {
  const dto = await apiRequest<TaskDraftDto>(`/api/teams/${teamId}/ai/task-draft`, { method: "POST", token, body: input });
  return mapTaskDraftDto(dto);
}

export type PersonalTrainingStyle = "reps" | "circuit";

export interface PersonalTrainingDraftInput {
  style: PersonalTrainingStyle;
  goals?: string | null;
  duration_minutes?: number | null;
}

export interface PersonalTrainingExerciseDraft {
  exercise: string;
  reps: number | null;
  sets: number | null;
  durationSeconds: number | null;
}

export interface PersonalTrainingDraft {
  style: PersonalTrainingStyle;
  exercises: PersonalTrainingExerciseDraft[];
  notes: string | null;
  durationMinutes: number | null;
}

interface PersonalTrainingExerciseDraftDto {
  exercise: string;
  reps: number | null;
  sets: number | null;
  duration_seconds: number | null;
}

interface PersonalTrainingDraftDto {
  style: PersonalTrainingStyle;
  exercises: PersonalTrainingExerciseDraftDto[];
  notes: string | null;
  duration_minutes: number | null;
}

export async function createPersonalTrainingDraft(
  token: string,
  input: PersonalTrainingDraftInput,
): Promise<PersonalTrainingDraft> {
  const dto = await apiRequest<PersonalTrainingDraftDto>("/api/ai/personal-training-draft", {
    method: "POST",
    token,
    body: input,
  });
  return {
    style: dto.style,
    exercises: dto.exercises.map((e) => ({ exercise: e.exercise, reps: e.reps, sets: e.sets, durationSeconds: e.duration_seconds })),
    notes: dto.notes,
    durationMinutes: dto.duration_minutes,
  };
}

async function getAiText(path: string, token: string, body?: unknown): Promise<string> {
  const dto = await apiRequest<{ text: string }>(path, { method: "POST", token, body });
  return dto.text;
}

export function getTrainingEvaluation(token: string, trainingId: string): Promise<string> {
  return getAiText("/api/ai/training-evaluation", token, { training_id: trainingId });
}

export function getProgressAnalysis(token: string): Promise<string> {
  return getAiText("/api/ai/progress-analysis", token);
}

export function getReportAnalysis(token: string, teamId: string): Promise<string> {
  return getAiText(`/api/teams/${teamId}/ai/report-analysis`, token);
}

export function getAttendanceAnalysis(token: string, teamId: string): Promise<string> {
  return getAiText(`/api/teams/${teamId}/ai/attendance-analysis`, token);
}

export function getTeamSummary(token: string, teamId: string): Promise<string> {
  return getAiText(`/api/teams/${teamId}/ai/team-summary`, token);
}
