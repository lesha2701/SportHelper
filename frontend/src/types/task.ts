export type TaskAssignmentStatus =
  | "assigned"
  | "viewed"
  | "in_progress"
  | "submitted"
  | "accepted"
  | "needs_revision"
  | "overdue"
  | "missed"
  | "cancelled";

export type TaskTargetType = "team" | "players" | "position" | "absentees";
export type TaskReviewDecision = "accepted" | "needs_revision";

export const TASK_STATUS_LABELS: Record<TaskAssignmentStatus, string> = {
  assigned: "Назначено",
  viewed: "Просмотрено",
  in_progress: "Выполняется",
  submitted: "Отправлено",
  accepted: "Принято",
  needs_revision: "Нужна доработка",
  overdue: "Просрочено",
  missed: "Пропущено",
  cancelled: "Отменено",
};

export const TASK_TARGET_LABELS: Record<TaskTargetType, string> = {
  team: "Вся команда",
  players: "Выбранные игроки",
  position: "Игроки по позиции",
  absentees: "Пропустившие тренировку",
};

export interface TaskExercise {
  id: string;
  taskId: string;
  exerciseId: string;
  exerciseName: string | null;
  orderIndex: number;
}

export interface TaskAssignment {
  id: string;
  taskId: string;
  userId: string;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  position: string | null;
  status: TaskAssignmentStatus;
  comment: string | null;
  photoFileId: string | null;
  videoFileId: string | null;
  sets: number | null;
  reps: number | null;
  durationMinutes: number | null;
  metricValue: number | null;
  difficulty: number | null;
  wellbeing: number | null;
  coachComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  viewedAt: string | null;
  submittedAt: string | null;
}

export interface Task {
  id: string;
  teamId: string;
  createdBy: string;
  title: string;
  description: string | null;
  planId: string | null;
  deadline: string | null;
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
  targetTrainingId: string | null;
  exercises: TaskExercise[];
  assignments: TaskAssignment[];
}

export interface MyTask {
  task: Task;
  assignment: TaskAssignment;
}

export interface TaskCreateInput {
  title: string;
  description: string | null;
  plan_id: string | null;
  exercise_ids: string[];
  deadline: string | null;
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
  player_ids: string[];
  position: string | null;
  training_id: string | null;
}

export interface TaskUpdateInput {
  title: string;
  description: string | null;
  plan_id: string | null;
  exercise_ids: string[];
  deadline: string | null;
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
}

export interface TaskSubmitInput {
  comment: string | null;
  sets: number | null;
  reps: number | null;
  duration_minutes: number | null;
  metric_value: number | null;
  difficulty: number | null;
  wellbeing: number | null;
}

export interface TaskExerciseDto {
  id: string;
  task_id: string;
  exercise_id: string;
  exercise_name: string | null;
  order_index: number;
}

export interface TaskAssignmentDto {
  id: string;
  task_id: string;
  user_id: string;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  position: string | null;
  status: TaskAssignmentStatus;
  comment: string | null;
  photo_file_id: string | null;
  video_file_id: string | null;
  sets: number | null;
  reps: number | null;
  duration_minutes: number | null;
  metric_value: number | null;
  difficulty: number | null;
  wellbeing: number | null;
  coach_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  viewed_at: string | null;
  submitted_at: string | null;
}

export interface TaskDto {
  id: string;
  team_id: string;
  created_by: string;
  title: string;
  description: string | null;
  plan_id: string | null;
  deadline: string | null;
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
  target_training_id: string | null;
  exercises: TaskExerciseDto[];
  assignments: TaskAssignmentDto[];
}

export interface MyTaskDto {
  task: TaskDto;
  assignment: TaskAssignmentDto;
}

export function mapTaskExerciseDto(dto: TaskExerciseDto): TaskExercise {
  return {
    id: dto.id,
    taskId: dto.task_id,
    exerciseId: dto.exercise_id,
    exerciseName: dto.exercise_name,
    orderIndex: dto.order_index,
  };
}

export function mapTaskAssignmentDto(dto: TaskAssignmentDto): TaskAssignment {
  return {
    id: dto.id,
    taskId: dto.task_id,
    userId: dto.user_id,
    telegramId: dto.telegram_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    photoUrl: dto.photo_url,
    position: dto.position,
    status: dto.status,
    comment: dto.comment,
    photoFileId: dto.photo_file_id,
    videoFileId: dto.video_file_id,
    sets: dto.sets,
    reps: dto.reps,
    durationMinutes: dto.duration_minutes,
    metricValue: dto.metric_value,
    difficulty: dto.difficulty,
    wellbeing: dto.wellbeing,
    coachComment: dto.coach_comment,
    reviewedBy: dto.reviewed_by,
    reviewedAt: dto.reviewed_at,
    viewedAt: dto.viewed_at,
    submittedAt: dto.submitted_at,
  };
}

export function mapTaskDto(dto: TaskDto): Task {
  return {
    id: dto.id,
    teamId: dto.team_id,
    createdBy: dto.created_by,
    title: dto.title,
    description: dto.description,
    planId: dto.plan_id,
    deadline: dto.deadline,
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
    targetTrainingId: dto.target_training_id,
    exercises: dto.exercises.map(mapTaskExerciseDto),
    assignments: dto.assignments.map(mapTaskAssignmentDto),
  };
}

export function mapMyTaskDto(dto: MyTaskDto): MyTask {
  return {
    task: mapTaskDto(dto.task),
    assignment: mapTaskAssignmentDto(dto.assignment),
  };
}
