import { apiRequest } from "./client";
import { mapMetricDto, type Metric, type MetricDto, type MetricInput } from "@/shared/types/metric";

export async function listMetrics(userId: string): Promise<Metric[]> {
  const dtos = await apiRequest<MetricDto[]>(`/api/players/${userId}/metrics`);
  return dtos.map(mapMetricDto);
}

export async function createMetric(userId: string, input: MetricInput): Promise<Metric> {
  const dto = await apiRequest<MetricDto>(`/api/players/${userId}/metrics`, { method: "POST", successMessage: "Метрика добавлена", body: input });
  return mapMetricDto(dto);
}

export async function updateMetric(metricId: string, input: MetricInput): Promise<Metric> {
  const dto = await apiRequest<MetricDto>(`/api/metrics/${metricId}`, { method: "PUT", successMessage: "Метрика сохранена", body: input });
  return mapMetricDto(dto);
}

export async function deleteMetric(metricId: string): Promise<void> {
  await apiRequest(`/api/metrics/${metricId}`, { method: "DELETE", successMessage: "Метрика удалена" });
}
