export type ReportStatus = "pending" | "accepted" | "needs_revision";

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "На проверке",
  accepted: "Принят",
  needs_revision: "Нужно доработать",
};

export interface Report {
  trainingId: string;
  submittedBy: string;
  textReport: string;
  photoFileId: string | null;
  videoFileId: string | null;
  status: ReportStatus;
  coachComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface ReportDto {
  training_id: string;
  submitted_by: string;
  text_report: string;
  photo_file_id: string | null;
  video_file_id: string | null;
  status: ReportStatus;
  coach_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export function mapReportDto(dto: ReportDto): Report {
  return {
    trainingId: dto.training_id,
    submittedBy: dto.submitted_by,
    textReport: dto.text_report,
    photoFileId: dto.photo_file_id,
    videoFileId: dto.video_file_id,
    status: dto.status,
    coachComment: dto.coach_comment,
    reviewedBy: dto.reviewed_by,
    reviewedAt: dto.reviewed_at,
  };
}
