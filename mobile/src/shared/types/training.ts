export type TrainingType = "team" | "personal" | "independent";
export type TrainingStatus = "scheduled" | "completed" | "cancelled";
export type AttendanceStatus = "present" | "absent";

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  scheduled: "Запланирована",
  completed: "Проведена",
  cancelled: "Отменена",
};

export function isTrainingOverdue(training: Pick<Training, "status" | "trainingDate">): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return training.status === "scheduled" && training.trainingDate < today;
}

export interface Training {
  id: string;
  teamId: string | null;
  createdBy: string;
  type: TrainingType;
  planId: string | null;
  trainingDate: string;
  startTime: string;
  durationMinutes: number;
  location: string | null;
  description: string | null;
  status: TrainingStatus;
  reminderMinutesBefore: number | null;
  recurrenceGroupId: string | null;
  responsibleUserId: string | null;
}

export interface TrainingCreateInput {
  training_date: string;
  start_time: string;
  duration_minutes: number;
  location: string | null;
  description: string | null;
  plan_id: string | null;
  reminder_minutes_before: number | null;
  repeat_weekly_until: string | null;
  is_independent: boolean;
  responsible_user_id: string | null;
}

export interface TrainingUpdateInput {
  training_date: string;
  start_time: string;
  duration_minutes: number;
  location: string | null;
  description: string | null;
  plan_id: string | null;
  reminder_minutes_before: number | null;
  status: TrainingStatus;
  is_independent: boolean;
  responsible_user_id: string | null;
}

export interface Attendance {
  trainingId: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  status: AttendanceStatus;
}

export interface TrainingDto {
  id: string;
  team_id: string | null;
  created_by: string;
  type: TrainingType;
  plan_id: string | null;
  training_date: string;
  start_time: string;
  duration_minutes: number;
  location: string | null;
  description: string | null;
  status: TrainingStatus;
  reminder_minutes_before: number | null;
  recurrence_group_id: string | null;
  responsible_user_id: string | null;
}

export interface AttendanceDto {
  training_id: string;
  user_id: string;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  status: AttendanceStatus;
}

export function mapTrainingDto(dto: TrainingDto): Training {
  return {
    id: dto.id,
    teamId: dto.team_id,
    createdBy: dto.created_by,
    type: dto.type,
    planId: dto.plan_id,
    trainingDate: dto.training_date,
    startTime: dto.start_time,
    durationMinutes: dto.duration_minutes,
    location: dto.location,
    description: dto.description,
    status: dto.status,
    reminderMinutesBefore: dto.reminder_minutes_before,
    recurrenceGroupId: dto.recurrence_group_id,
    responsibleUserId: dto.responsible_user_id,
  };
}

export function mapAttendanceDto(dto: AttendanceDto): Attendance {
  return {
    trainingId: dto.training_id,
    userId: dto.user_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    photoUrl: dto.photo_url,
    status: dto.status,
  };
}

export interface TrainingFeedback {
  trainingId: string;
  userId: string;
  wellbeing: number | null;
  difficulty: number | null;
  comment: string | null;
  /** The coach's overall rating of the team (1-5); null on a player's own feedback. */
  teamRating: number | null;
  skipped: boolean;
}

export interface TrainingFeedbackInput {
  wellbeing?: number | null;
  difficulty: number | null;
  comment: string | null;
  /** Only the team's staff may send it. */
  team_rating?: number | null;
}

export interface TrainingFeedbackDto {
  training_id: string;
  user_id: string;
  wellbeing: number | null;
  difficulty: number | null;
  comment: string | null;
  team_rating?: number | null;
  skipped: boolean;
}

export function mapTrainingFeedbackDto(dto: TrainingFeedbackDto): TrainingFeedback {
  return {
    trainingId: dto.training_id,
    userId: dto.user_id,
    wellbeing: dto.wellbeing,
    difficulty: dto.difficulty,
    comment: dto.comment,
    teamRating: dto.team_rating ?? null,
    skipped: dto.skipped,
  };
}

/** What one set of an exercise is measured in: repetitions (with a weight), time under load, or distance. */
export type WorkoutMetric = "reps" | "time" | "distance";

export interface WorkoutSet {
  reps: number;
  weightKg: number | null;
  /** Time metric: how long the set lasted. */
  seconds: number | null;
  /** Distance metric: how far, in meters. */
  meters: number | null;
  done: boolean;
}

export interface WorkoutExercise {
  name: string;
  metric: WorkoutMetric;
  targetSets: number | null;
  targetReps: number | null;
  /** The planned time of a timed exercise, or the target time of a distance one. */
  targetSeconds: number | null;
  targetMeters: number | null;
  sets: WorkoutSet[];
}

/** What a person actually did in a guided workout: every set with its repetitions and weight. */
export interface TrainingWorkout {
  trainingId: string;
  exercises: WorkoutExercise[];
  wellbeing: number | null;
  note: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TrainingWorkoutDto {
  training_id: string;
  exercises: {
    name: string;
    metric?: WorkoutMetric;
    target_sets: number | null;
    target_reps: number | null;
    target_seconds?: number | null;
    target_meters?: number | null;
    sets: { reps: number; weight_kg: number | null; seconds?: number | null; meters?: number | null; done: boolean }[];
  }[];
  wellbeing: number | null;
  note: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export function mapWorkoutDto(dto: TrainingWorkoutDto): TrainingWorkout {
  return {
    trainingId: dto.training_id,
    exercises: dto.exercises.map((e) => ({
      name: e.name,
      metric: e.metric ?? "reps",
      targetSets: e.target_sets,
      targetReps: e.target_reps,
      targetSeconds: e.target_seconds ?? null,
      targetMeters: e.target_meters ?? null,
      sets: e.sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, seconds: s.seconds ?? null, meters: s.meters ?? null, done: s.done })),
    })),
    wellbeing: dto.wellbeing,
    note: dto.note,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
  };
}

export function workoutToDto(workout: Omit<TrainingWorkout, "trainingId">): Omit<TrainingWorkoutDto, "training_id"> {
  return {
    exercises: workout.exercises.map((e) => ({
      name: e.name,
      metric: e.metric,
      target_sets: e.targetSets,
      target_reps: e.targetReps,
      target_seconds: e.targetSeconds,
      target_meters: e.targetMeters,
      sets: e.sets.map((s) => ({ reps: s.reps, weight_kg: s.weightKg, seconds: s.seconds, meters: s.meters, done: s.done })),
    })),
    wellbeing: workout.wellbeing,
    note: workout.note,
    started_at: workout.startedAt,
    finished_at: workout.finishedAt,
  };
}
