import { apiRequest } from "./client";
import {
  mapAttendanceDto,
  mapTrainingDto,
  mapTrainingFeedbackDto,
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
} from "../types/training";

export async function createTeamTraining(token: string, teamId: string, input: TrainingCreateInput): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>(`/api/teams/${teamId}/trainings`, { method: "POST", token, body: input });
  return dtos.map(mapTrainingDto);
}

export async function createPersonalTraining(token: string, input: TrainingCreateInput): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>("/api/trainings/personal", { method: "POST", token, body: input });
  return dtos.map(mapTrainingDto);
}

export async function listTeamTrainings(token: string, teamId: string): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>(`/api/teams/${teamId}/trainings`, { token });
  return dtos.map(mapTrainingDto);
}

export async function listMyPersonalTrainings(token: string): Promise<Training[]> {
  const dtos = await apiRequest<TrainingDto[]>("/api/trainings/mine", { token });
  return dtos.map(mapTrainingDto);
}

export async function getTraining(token: string, trainingId: string): Promise<Training> {
  const dto = await apiRequest<TrainingDto>(`/api/trainings/${trainingId}`, { token });
  return mapTrainingDto(dto);
}

export async function updateTraining(token: string, trainingId: string, input: TrainingUpdateInput): Promise<Training> {
  const dto = await apiRequest<TrainingDto>(`/api/trainings/${trainingId}`, { method: "PUT", token, body: input });
  return mapTrainingDto(dto);
}

export async function deleteTraining(token: string, trainingId: string): Promise<void> {
  await apiRequest(`/api/trainings/${trainingId}`, { method: "DELETE", token });
}

export async function cancelTrainingSeries(token: string, trainingId: string): Promise<void> {
  await apiRequest(`/api/trainings/${trainingId}/cancel-series`, { method: "POST", token });
}

export async function getAttendance(token: string, trainingId: string): Promise<Attendance[]> {
  const dtos = await apiRequest<AttendanceDto[]>(`/api/trainings/${trainingId}/attendance`, { token });
  return dtos.map(mapAttendanceDto);
}

export async function setAttendanceStatus(
  token: string,
  trainingId: string,
  userId: string,
  status: AttendanceStatus,
): Promise<Attendance> {
  const dto = await apiRequest<AttendanceDto>(`/api/trainings/${trainingId}/attendance/${userId}`, {
    method: "PATCH",
    token,
    body: { status },
  });
  return mapAttendanceDto(dto);
}

export async function getTrainingFeedback(token: string, trainingId: string): Promise<TrainingFeedback | null> {
  const dto = await apiRequest<TrainingFeedbackDto | null>(`/api/trainings/${trainingId}/feedback`, { token });
  return dto ? mapTrainingFeedbackDto(dto) : null;
}

export async function submitTrainingFeedback(
  token: string,
  trainingId: string,
  input: TrainingFeedbackInput,
): Promise<TrainingFeedback> {
  const dto = await apiRequest<TrainingFeedbackDto>(`/api/trainings/${trainingId}/feedback`, {
    method: "POST",
    token,
    body: input,
  });
  return mapTrainingFeedbackDto(dto);
}

export async function skipTrainingFeedback(token: string, trainingId: string): Promise<TrainingFeedback> {
  const dto = await apiRequest<TrainingFeedbackDto>(`/api/trainings/${trainingId}/feedback/skip`, {
    method: "POST",
    token,
  });
  return mapTrainingFeedbackDto(dto);
}
