import { apiRequest, apiUpload, type UploadFile } from "./client";
import { mapExerciseDto, type Exercise, type ExerciseDto, type ExerciseInput } from "@/shared/types/exercise";

export async function listMyExercises(): Promise<Exercise[]> {
  const dtos = await apiRequest<ExerciseDto[]>("/api/exercises/mine");
  return dtos.map(mapExerciseDto);
}

export async function getExercise(exerciseId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}`);
  return mapExerciseDto(dto);
}

export async function createExercise(input: ExerciseInput): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>("/api/exercises", { method: "POST", successMessage: "Упражнение создано", body: input });
  return mapExerciseDto(dto);
}

export async function updateExercise(exerciseId: string, input: ExerciseInput): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}`, { method: "PUT", successMessage: "Упражнение сохранено", body: input });
  return mapExerciseDto(dto);
}

export async function deleteExercise(exerciseId: string): Promise<void> {
  await apiRequest(`/api/exercises/${exerciseId}`, { method: "DELETE", successMessage: "Упражнение удалено" });
}

export async function shareExercise(exerciseId: string, teamId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}/share`, {
    method: "POST", successMessage: "Упражнение доступно команде",
    body: { team_id: teamId },
  });
  return mapExerciseDto(dto);
}

export async function unshareExercise(exerciseId: string, teamId: string): Promise<Exercise> {
  const dto = await apiRequest<ExerciseDto>(`/api/exercises/${exerciseId}/share/${teamId}`, {
    method: "DELETE", successMessage: "Доступ команды к упражнению закрыт",
  });
  return mapExerciseDto(dto);
}

export async function uploadExercisePhoto(exerciseId: string, file: UploadFile): Promise<Exercise> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<ExerciseDto>(`/api/exercises/${exerciseId}/photo`, { formData });
  return mapExerciseDto(dto);
}

export async function uploadExerciseVideo(exerciseId: string, file: UploadFile): Promise<Exercise> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<ExerciseDto>(`/api/exercises/${exerciseId}/video`, { formData });
  return mapExerciseDto(dto);
}

/** The exercises the coach opened to this team (readable by any member). */
export async function listTeamExercises(teamId: string): Promise<Exercise[]> {
  const dtos = await apiRequest<ExerciseDto[]>(`/api/teams/${teamId}/exercises`);
  return dtos.map(mapExerciseDto);
}
