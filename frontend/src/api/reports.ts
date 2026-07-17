import { apiRequest, apiUpload } from "./client";
import { mapReportDto, type Report, type ReportDto } from "../types/report";

export async function getReport(token: string, trainingId: string): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report`, { token });
  return mapReportDto(dto);
}

export async function submitReport(token: string, trainingId: string, textReport: string): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report`, {
    method: "POST",
    token,
    body: { text_report: textReport },
  });
  return mapReportDto(dto);
}

export async function reviewReport(
  token: string,
  trainingId: string,
  decision: "accepted" | "needs_revision",
  coachComment: string | null,
): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report/review`, {
    method: "POST",
    token,
    body: { decision, coach_comment: coachComment },
  });
  return mapReportDto(dto);
}

export async function uploadReportPhoto(token: string, trainingId: string, file: File): Promise<Report> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<ReportDto>(`/api/trainings/${trainingId}/report/photo`, { token, formData });
  return mapReportDto(dto);
}

export async function uploadReportVideo(token: string, trainingId: string, file: File): Promise<Report> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<ReportDto>(`/api/trainings/${trainingId}/report/video`, { token, formData });
  return mapReportDto(dto);
}
