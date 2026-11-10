import { apiRequest } from "./client";
import { mapPlanDto, type Plan, type PlanDto, type PlanExerciseDto, type PlanExerciseInput, type PlanInput } from "@/shared/types/plan";

export async function listMyPlans(): Promise<Plan[]> {
  const dtos = await apiRequest<PlanDto[]>("/api/plans/mine");
  return dtos.map(mapPlanDto);
}

export async function getPlan(planId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}`);
  return mapPlanDto(dto);
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  const dto = await apiRequest<PlanDto>("/api/plans", { method: "POST", successMessage: "План создан", body: input });
  return mapPlanDto(dto);
}

export async function updatePlan(planId: string, input: PlanInput): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}`, { method: "PUT", successMessage: "План сохранён", body: input });
  return mapPlanDto(dto);
}

export async function deletePlan(planId: string): Promise<void> {
  await apiRequest(`/api/plans/${planId}`, { method: "DELETE", successMessage: "План удалён" });
}

export async function duplicatePlan(planId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/duplicate`, { method: "POST", successMessage: "План скопирован" });
  return mapPlanDto(dto);
}

export async function addPlanExercise(planId: string, input: PlanExerciseInput): Promise<PlanExerciseDto> {
  return apiRequest<PlanExerciseDto>(`/api/plans/${planId}/exercises`, { method: "POST", successMessage: "Упражнение добавлено в план", body: input });
}

export async function removePlanExercise(planId: string, planExerciseId: string): Promise<void> {
  await apiRequest(`/api/plans/${planId}/exercises/${planExerciseId}`, { method: "DELETE", successMessage: "Упражнение убрано из плана" });
}

export async function sharePlan(planId: string, teamId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/share`, { method: "POST", successMessage: "План отправлен команде", body: { team_id: teamId } });
  return mapPlanDto(dto);
}

export async function unsharePlan(planId: string, teamId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/share/${teamId}`, { method: "DELETE", successMessage: "Доступ команды к плану закрыт" });
  return mapPlanDto(dto);
}
