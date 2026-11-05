import { apiRequest } from "./client";
import {
  mapTaskTemplateDto,
  type TaskTemplate,
  type TaskTemplateDto,
  type TaskTemplateInput,
} from "@/shared/types/taskTemplate";

export async function listMyTemplates(): Promise<TaskTemplate[]> {
  const dtos = await apiRequest<TaskTemplateDto[]>("/api/task-templates/mine");
  return dtos.map(mapTaskTemplateDto);
}

export async function getTemplate(templateId: string): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>(`/api/task-templates/${templateId}`);
  return mapTaskTemplateDto(dto);
}

export async function createTemplate(input: TaskTemplateInput): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>("/api/task-templates", { method: "POST", successMessage: "Шаблон создан", body: input });
  return mapTaskTemplateDto(dto);
}

export async function updateTemplate(templateId: string, input: TaskTemplateInput): Promise<TaskTemplate> {
  const dto = await apiRequest<TaskTemplateDto>(`/api/task-templates/${templateId}`, { method: "PUT", successMessage: "Шаблон сохранён", body: input });
  return mapTaskTemplateDto(dto);
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await apiRequest(`/api/task-templates/${templateId}`, { method: "DELETE", successMessage: "Шаблон удалён" });
}
