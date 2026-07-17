import { apiRequest, apiUpload } from "./client";
import { mapExerciseDto, type Exercise, type ExerciseDto, type ExerciseInput } from "../types/exercise";

export async function listMyExercises(token: string): Promise<Exercise[]> {
  const dtos = await apiRequest<ExerciseDto[]>("/api/exercises/mine", { token });
  return dtos.map(mapExerciseDto);
}

export async function getExercise(token: string, exerciseId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}`, { token });
  return mapExerciseDto(dto);
}

export async function createExercise(token: string, input: ExerciseInput): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>("/api/exercises", { method: "POST", token, body: input });
  return mapExerciseDto(dto);
}

export async function updateExercise(token: string, exerciseId: string, input: ExerciseInput): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}`, { method: "PUT", token, body: input });
  return mapExerciseDto(dto);
}

export async function deleteExercise(token: string, exerciseId: string): Promise<void> {
  await apiRequest(`/api/exercises/${exerciseId}`, { method: "DELETE", token });
}

export async function shareExercise(token: string, exerciseId: string, teamId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}/share`, {
    method: "POST",
    token,
    body: { team_id: teamId },
  });
  return mapExerciseDto(dto);
}

export async function unshareExercise(token: string, exerciseId: string, teamId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}/share/${teamId}`, {
    method: "DELETE",
    token,
  });
  return mapExerciseDto(dto);
}

export async function uploadExercisePhoto(token: string, exerciseId: string, file: File): Promise<Exercise> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<ExerciseDto>(`/api/exercises/${exerciseId}/photo`, { token, formData });
  return mapExerciseDto(dto);
}

export async function uploadExerciseVideo(token: string, exerciseId: string, file: File): Promise<Exercise> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<ExerciseDto>(`/api/exercises/${exerciseId}/video`, { token, formData });
  return mapExerciseDto(dto);
}
