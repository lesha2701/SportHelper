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
  telegramId: number;
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
  telegram_id: number;
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
    telegramId: dto.telegram_id,
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
  skipped: boolean;
}

export interface TrainingFeedbackInput {
  wellbeing: number | null;
  difficulty: number | null;
  comment: string | null;
}

export interface TrainingFeedbackDto {
  training_id: string;
  user_id: string;
  wellbeing: number | null;
  difficulty: number | null;
  comment: string | null;
  skipped: boolean;
}

export function mapTrainingFeedbackDto(dto: TrainingFeedbackDto): TrainingFeedback {
  return {
    trainingId: dto.training_id,
    userId: dto.user_id,
    wellbeing: dto.wellbeing,
    difficulty: dto.difficulty,
    comment: dto.comment,
    skipped: dto.skipped,
  };
}
