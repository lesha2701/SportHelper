import { apiRequest } from "./client";
import { mapMetricDto, type Metric, type MetricDto, type MetricInput } from "../types/metric";

export async function listMetrics(token: string, userId: string): Promise<Metric[]> {
  const dtos = await apiRequest<MetricDto[]>(`/api/players/${userId}/metrics`, { token });
  return dtos.map(mapMetricDto);
}

export async function createMetric(token: string, userId: string, input: MetricInput): Promise<Metric> {
  const dto = await apiRequest<MetricDto>(`/api/players/${userId}/metrics`, { method: "POST", token, body: input });
  return mapMetricDto(dto);
}

export async function updateMetric(token: string, metricId: string, input: MetricInput): Promise<Metric> {
  const dto = await apiRequest<MetricDto>(`/api/metrics/${metricId}`, { method: "PUT", token, body: input });
  return mapMetricDto(dto);
}

export async function deleteMetric(token: string, metricId: string): Promise<void> {
  await apiRequest(`/api/metrics/${metricId}`, { method: "DELETE", token });
}
