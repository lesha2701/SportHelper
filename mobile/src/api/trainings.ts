import { apiRequest } from "./client";
import {
  mapAttendanceDto,
  mapTrainingDto,
  mapTrainingFeedbackDto,
  mapWorkoutDto,
  workoutToDto,
  type Attendance,
  type AttendanceDto,
  type AttendanceStatus,
  type Training,
  type TrainingCreateInput,
  type TrainingDto,
  type TrainingFeedback,
  type TrainingFeedbackDto,
  type TrainingFeedbackInput,
  type TrainingUpdateInput,
  type TrainingWorkout,
  type TrainingWorkoutDto,
} from "@/shared/types/training";

export async function createTeamTraining(teamId: string, input: TrainingCreateInput): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>(`/api/teams/${teamId}/trainings`, { method: "POST", silent: true, body: input });
  return dtos.map(mapTrainingDto);
}

export async function createPersonalTraining(input: TrainingCreateInput): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>("/api/trainings/personal", { method: "POST", silent: true, body: input });
  return dtos.map(mapTrainingDto);
}

export async function listTeamTrainings(teamId: string): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>(`/api/teams/${teamId}/trainings`);
  return dtos.map(mapTrainingDto);
}

export async function listMyPersonalTrainings(): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>("/api/trainings/mine");
  return dtos.map(mapTrainingDto);
}

export async function getTraining(trainingId: string): Promise<Training> {
  const dto = await apiRequest<TrainingDto>(`/api/trainings/${trainingId}`);
  return mapTrainingDto(dto);
}

export async function updateTraining(trainingId: string, input: TrainingUpdateInput): Promise<Training> {
  const dto = await apiRequest<TrainingDto>(`/api/trainings/${trainingId}`, { method: "PUT", successMessage: "Тренировка сохранена", body: input });
  return mapTrainingDto(dto);
}

export async function deleteTraining(trainingId: string): Promise<void> {
  await apiRequest(`/api/trainings/${trainingId}`, { method: "DELETE", successMessage: "Тренировка удалена" });
}

export async function cancelTrainingSeries(trainingId: string): Promise<void> {
  await apiRequest(`/api/trainings/${trainingId}/cancel-series`, { method: "POST", successMessage: "Серия тренировок отменена" });
}

export async function getAttendance(trainingId: string): Promise<Attendance[]> {
  const dtos = await apiRequest<AttendanceDto[]>(`/api/trainings/${trainingId}/attendance`);
  return dtos.map(mapAttendanceDto);
}

export async function setAttendanceStatus(
  trainingId: string,
  userId: string,
  status: AttendanceStatus,
): Promise<Attendance> {
  const dto = await apiRequest<AttendanceDto>(`/api/trainings/${trainingId}/attendance/${userId}`, {
    method: "PATCH", silent: true,
    body: { status },
  });
  return mapAttendanceDto(dto);
}

export async function getTrainingFeedback(trainingId: string): Promise<TrainingFeedback | null> {
  const dto = await apiRequest<TrainingFeedbackDto | null>(`/api/trainings/${trainingId}/feedback`);
  return dto ? mapTrainingFeedbackDto(dto) : null;
}

export async function submitTrainingFeedback(
  trainingId: string,
  input: TrainingFeedbackInput,
): Promise<TrainingFeedback> {
  const dto = await apiRequest<TrainingFeedbackDto>(`/api/trainings/${trainingId}/feedback`, {
    method: "POST", successMessage: "Спасибо за отзыв",
    body: input,
  });
  return mapTrainingFeedbackDto(dto);
}

export async function skipTrainingFeedback(trainingId: string): Promise<TrainingFeedback> {
  const dto = await apiRequest<TrainingFeedbackDto>(`/api/trainings/${trainingId}/feedback/skip`, {
    method: "POST", silent: true,
  });
  return mapTrainingFeedbackDto(dto);
}

export async function getTrainingWorkout(trainingId: string): Promise<TrainingWorkout | null> {
  const dto = await apiRequest<TrainingWorkoutDto | null>(`/api/trainings/${trainingId}/workout`, { silent: true });
  return dto ? mapWorkoutDto(dto) : null;
}

export async function saveTrainingWorkout(
  trainingId: string,
  workout: Omit<TrainingWorkout, "trainingId">,
): Promise<TrainingWorkout> {
  const dto = await apiRequest<TrainingWorkoutDto>(`/api/trainings/${trainingId}/workout`, {
    method: "PUT",
    successMessage: "Результат тренировки сохранён",
    body: workoutToDto(workout),
  });
  return mapWorkoutDto(dto);
}
