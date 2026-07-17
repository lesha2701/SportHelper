import { apiRequest, apiUpload } from "./client";
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
} from "../types/task";

export async function createTask(token: string, teamId: string, input: TaskCreateInput): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/teams/${teamId}/tasks`, { method: "POST", token, body: input });
  return mapTaskDto(dto);
}

export async function listTeamTasks(token: string, teamId: string): Promise<Task[]> {
  const dtos = await apiRequest<TaskDto[]>(`/api/teams/${teamId}/tasks`, { token });
  return dtos.map(mapTaskDto);
}

export async function listMyTasks(token: string): Promise<MyTask[]> {
  const dtos = await apiRequest<MyTaskDto[]>("/api/tasks/mine", { token });
  return dtos.map(mapMyTaskDto);
}

export async function getTask(token: string, taskId: string): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/tasks/${taskId}`, { token });
  return mapTaskDto(dto);
}

export async function updateTask(token: string, taskId: string, input: TaskUpdateInput): Promise<Task> {
  const dto = await apiRequest<TaskDto>(`/api/tasks/${taskId}`, { method: "PUT", token, body: input });
  return mapTaskDto(dto);
}

export async function deleteTask(token: string, taskId: string): Promise<void> {
  await apiRequest(`/api/tasks/${taskId}`, { method: "DELETE", token });
}

export async function startTask(token: string, taskId: string): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/start`, { method: "POST", token });
  return mapTaskAssignmentDto(dto);
}

export async function submitTask(token: string, taskId: string, input: TaskSubmitInput): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/submit`, { method: "POST", token, body: input });
  return mapTaskAssignmentDto(dto);
}

export async function uploadTaskPhoto(token: string, taskId: string, file: File): Promise<TaskAssignment> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<TaskAssignmentDto>(`/api/tasks/${taskId}/submit/photo`, { token, formData });
  return mapTaskAssignmentDto(dto);
}

export async function uploadTaskVideo(token: string, taskId: string, file: File): Promise<TaskAssignment> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<TaskAssignmentDto>(`/api/tasks/${taskId}/submit/video`, { token, formData });
  return mapTaskAssignmentDto(dto);
}

export async function reviewTask(
  token: string,
  taskId: string,
  userId: string,
  decision: TaskReviewDecision,
  coachComment: string | null,
): Promise<TaskAssignment> {
  const dto = await apiRequest<TaskAssignmentDto>(`/api/tasks/${taskId}/review/${userId}`, {
    method: "POST",
    token,
    body: { decision, coach_comment: coachComment },
  });
  return mapTaskAssignmentDto(dto);
}
