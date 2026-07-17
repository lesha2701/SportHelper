import { apiRequest } from "./client";
import { mapPlanDto, type Plan, type PlanDto, type PlanExerciseDto, type PlanExerciseInput, type PlanInput } from "../types/plan";

export async function listMyPlans(token: string): Promise<Plan[]> {
  const dtos = await apiRequest<PlanDto[]>("/api/plans/mine", { token });
  return dtos.map(mapPlanDto);
}

export async function getPlan(token: string, planId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}`, { token });
  return mapPlanDto(dto);
}

export async function createPlan(token: string, input: PlanInput): Promise<Plan> {
  const dto = await apiRequest<PlanDto>("/api/plans", { method: "POST", token, body: input });
  return mapPlanDto(dto);
}

export async function updatePlan(token: string, planId: string, input: PlanInput): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}`, { method: "PUT", token, body: input });
  return mapPlanDto(dto);
}

export async function deletePlan(token: string, planId: string): Promise<void> {
  await apiRequest(`/api/plans/${planId}`, { method: "DELETE", token });
}

export async function duplicatePlan(token: string, planId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/duplicate`, { method: "POST", token });
  return mapPlanDto(dto);
}

export async function addPlanExercise(token: string, planId: string, input: PlanExerciseInput): Promise<PlanExerciseDto> {
  return apiRequest<PlanExerciseDto>(`/api/plans/${planId}/exercises`, { method: "POST", token, body: input });
}

export async function removePlanExercise(token: string, planId: string, planExerciseId: string): Promise<void> {
  await apiRequest(`/api/plans/${planId}/exercises/${planExerciseId}`, { method: "DELETE", token });
}

export async function sharePlan(token: string, planId: string, teamId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/share`, { method: "POST", token, body: { team_id: teamId } });
  return mapPlanDto(dto);
}

export async function unsharePlan(token: string, planId: string, teamId: string): Promise<Plan> {
  const dto = await apiRequest<PlanDto>(`/api/plans/${planId}/share/${teamId}`, { method: "DELETE", token });
  return mapPlanDto(dto);
}
