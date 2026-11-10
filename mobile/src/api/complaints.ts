import { apiRequest } from "./client";

export type ComplaintTarget = "user" | "listing" | "media";
export type ComplaintReason = "inappropriate" | "fraud" | "spam" | "false_info" | "other";

export const REPORT_REASONS: { value: ComplaintReason; label: string }[] = [
  { value: "inappropriate", label: "Недопустимый контент" },
  { value: "fraud", label: "Мошенничество" },
  { value: "spam", label: "Спам" },
  { value: "false_info", label: "Ложная информация" },
  { value: "other", label: "Другая причина" },
];

/** Reports a profile, a listing or a public photo/video. */
export async function createComplaint(input: { targetType: ComplaintTarget; targetId: string; reason: ComplaintReason; comment: string | null }): Promise<void> {
  await apiRequest("/api/complaints", {
    method: "POST",
    successMessage: "Жалоба отправлена. Спасибо, мы её рассмотрим.",
    body: { target_type: input.targetType, target_id: input.targetId, reason: input.reason, comment: input.comment },
  });
}
