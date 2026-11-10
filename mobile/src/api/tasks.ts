import { apiRequest, apiUpload, type UploadFile } from "./client";
import {
  mapMyTaskDto,
  mapTaskAssignmentDto,
  mapTaskDto,
  type MyTask,
  type MyTaskDto,
  type Task,
  type TaskAssignment,
  type TaskAssignmentDto,
  type TaskCreateInput,
  type TaskDto,
  type TaskReviewDecision,
  type TaskSubmitInput,
  type TaskUpdateInput,
} from "@/shared/types/task";

export async function createTask(teamId: string, input: TaskCreateInput): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/teams/${teamId}/tasks`, { method: "POST", successMessage: "Задание создано", body: input });
  return mapTaskDto(dto);
}

export async function listTeamTasks(teamId: string): Promise<Task[]> {
  const dtos = await apiRequest<TaskDto[]>(`/api/teams/${teamId}/tasks`);
  return dtos.map(mapTaskDto);
}

export async function listMyTasks(): Promise<MyTask[]> {
  const dtos = await apiRequest<MyTaskDto[]>("/api/tasks/mine");
  return dtos.map(mapMyTaskDto);
}

export async function getTask(taskId: string): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/tasks/${taskId}`);
  return mapTaskDto(dto);
}

export async function updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/tasks/${taskId}`, { method: "PUT", successMessage: "Задание сохранено", body: input });
  return mapTaskDto(dto);
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiRequest(`/api/tasks/${taskId}`, { method: "DELETE", successMessage: "Задание удалено" });
}

export async function startTask(taskId: string): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/start`, { method: "POST", successMessage: "Задание взято в работу" });
  return mapTaskAssignmentDto(dto);
}

export async function submitTask(taskId: string, input: TaskSubmitInput): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/submit`, { method: "POST", successMessage: "Отчёт по заданию отправлен", body: input });
  return mapTaskAssignmentDto(dto);
}

export async function uploadTaskPhoto(taskId: string, file: UploadFile): Promise<TaskAssignment> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<TaskAssignmentDto>(`/api/tasks/${taskId}/submit/photo`, { formData });
  return mapTaskAssignmentDto(dto);
}

export async function uploadTaskVideo(taskId: string, file: UploadFile): Promise<TaskAssignment> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<TaskAssignmentDto>(`/api/tasks/${taskId}/submit/video`, { formData });
  return mapTaskAssignmentDto(dto);
}

export async function reviewTask(
  taskId: string,
  userId: string,
  decision: TaskReviewDecision,
  coachComment: string | null,
): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/review/${userId}`, {
    method: "POST", successMessage: "Проверка сохранена",
    body: { decision, coach_comment: coachComment },
  });
  return mapTaskAssignmentDto(dto);
}
