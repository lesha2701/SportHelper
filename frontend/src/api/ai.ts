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

// --- Coach's AI pre-session analysis of an athlete -------------------------

export interface PlayerAnalysisPlanStep {
  stage: string;
  description: string;
  exerciseId: string | null;
  exerciseName: string | null;
}

export type DataSufficiency = "sufficient" | "limited" | "insufficient";

export interface PlayerPreSessionAnalysis {
  summary: string;
  strengths: string[];
  attentionPoints: string[];
  recentDynamics: string[];
  recommendations: string[];
  sessionFocus: string | null;
  sessionPlan: PlayerAnalysisPlanStep[];
  dataSufficiency: DataSufficiency;
  dataNotes: string | null;
  generatedAt: string;
}

export interface PlayerAnalysisStatus {
  /** The player currently lets personal coaches use AI analysis. */
  allowed: boolean;
  analysis: PlayerPreSessionAnalysis | null;
}

interface PlayerPreSessionAnalysisDto {
  summary: string;
  strengths: string[];
  attention_points: string[];
  recent_dynamics: string[];
  recommendations: string[];
  session_focus: string | null;
  session_plan: { stage: string; description: string; exercise_id: string | null; exercise_name: string | null }[];
  data_sufficiency: DataSufficiency;
  data_notes: string | null;
  generated_at: string;
}

function mapPlayerAnalysisDto(dto: PlayerPreSessionAnalysisDto): PlayerPreSessionAnalysis {
  return {
    summary: dto.summary,
    strengths: dto.strengths,
    attentionPoints: dto.attention_points,
    recentDynamics: dto.recent_dynamics,
    recommendations: dto.recommendations,
    sessionFocus: dto.session_focus,
    sessionPlan: dto.session_plan.map((s) => ({
      stage: s.stage,
      description: s.description,
      exerciseId: s.exercise_id,
      exerciseName: s.exercise_name,
    })),
    dataSufficiency: dto.data_sufficiency,
    dataNotes: dto.data_notes,
    generatedAt: dto.generated_at,
  };
}

/** Whether the athlete allows AI analysis, plus the last saved analysis (only
 * ever returned while they allow it). The athlete is derived server-side from
 * the personal training; nothing about them is passed from here. */
export async function getPersonalTrainingPlayerAnalysis(token: string, trainingId: string): Promise<PlayerAnalysisStatus> {
  const dto = await apiRequest<{ allowed: boolean; analysis: PlayerPreSessionAnalysisDto | null }>(
    `/api/trainings/${trainingId}/ai/player-analysis`,
    { token },
  );
  return { allowed: dto.allowed, analysis: dto.analysis ? mapPlayerAnalysisDto(dto.analysis) : null };
}

export async function analyzePersonalTrainingPlayer(token: string, trainingId: string): Promise<PlayerPreSessionAnalysis> {
  // silent: the card shows the failure inline, next to the button
  const dto = await apiRequest<PlayerPreSessionAnalysisDto>(`/api/trainings/${trainingId}/ai/player-analysis`, {
    method: "POST",
    token,
    silent: true,
  });
  return mapPlayerAnalysisDto(dto);
}
