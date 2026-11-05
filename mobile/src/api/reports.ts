import { apiRequest, apiUpload, type UploadFile } from "./client";
import { mapReportDto, type Report, type ReportDto } from "@/shared/types/report";

export async function getReport(trainingId: string): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report`);
  return mapReportDto(dto);
}

export async function submitReport(trainingId: string, textReport: string): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report`, {
    method: "POST", successMessage: "Отчёт отправлен",
    body: { text_report: textReport },
  });
  return mapReportDto(dto);
}

export async function reviewReport(
  trainingId: string,
  decision: "accepted" | "needs_revision",
  coachComment: string | null,
): Promise<Report> {
  const dto = await apiRequest<ReportDto>(`/api/trainings/${trainingId}/report/review`, {
    method: "POST", successMessage: "Комментарий к отчёту сохранён",
    body: { decision, coach_comment: coachComment },
  });
  return mapReportDto(dto);
}

export async function uploadReportPhoto(trainingId: string, file: UploadFile): Promise<Report> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<ReportDto>(`/api/trainings/${trainingId}/report/photo`, { formData });
  return mapReportDto(dto);
}

export async function uploadReportVideo(trainingId: string, file: UploadFile): Promise<Report> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  const dto = await apiUpload<ReportDto>(`/api/trainings/${trainingId}/report/video`, { formData });
  return mapReportDto(dto);
}
