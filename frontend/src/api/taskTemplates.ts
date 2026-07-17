import { apiRequest } from "./client";
import {
  mapTaskTemplateDto,
  type TaskTemplate,
  type TaskTemplateDto,
  type TaskTemplateInput,
} from "../types/taskTemplate";

export async function listMyTemplates(token: string): Promise<TaskTemplate[]> {
  const dtos = await apiRequest<TaskTemplateDto[]>("/api/task-templates/mine", { token });
  return dtos.map(mapTaskTemplateDto);
}

export async function getTemplate(token: string, templateId: string): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>(`/api/task-templates/${templateId}`, { token });
  return mapTaskTemplateDto(dto);
}

export async function createTemplate(token: string, input: TaskTemplateInput): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>("/api/task-templates", { method: "POST", token, body: input });
  return mapTaskTemplateDto(dto);
}

export async function updateTemplate(token: string, templateId: string, input: TaskTemplateInput): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>(`/api/task-templates/${templateId}`, { method: "PUT", token, body: input });
  return mapTaskTemplateDto(dto);
}

export async function deleteTemplate(token: string, templateId: string): Promise<void> {
  await apiRequest(`/api/task-templates/${templateId}`, { method: "DELETE", token });
}
