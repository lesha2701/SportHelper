import { apiRequest } from "./client";

export type SupportKind = "question" | "suggestion" | "conflict" | "bug" | "payment" | "other";
export type SupportStatus = "new" | "in_progress" | "answered" | "closed";

export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  question: "Вопрос",
  suggestion: "Предложение",
  conflict: "Конфликт",
  bug: "Ошибка в работе",
  payment: "Оплата и деньги",
  other: "Другое",
};

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  new: "Отправлено",
  in_progress: "В работе",
  answered: "Есть ответ",
  closed: "Закрыто",
};

export interface MySupportRequest {
  id: string;
  kind: SupportKind;
  subject: string;
  body: string;
  status: SupportStatus;
  createdAt: string;
  answer: string | null;
  answeredAt: string | null;
}

interface MySupportRequestDto {
  id: string;
  kind: SupportKind;
  subject: string;
  body: string;
  status: SupportStatus;
  created_at: string;
  answer: string | null;
  answered_at: string | null;
}

/** The form shows its own «спасибо» and its own error, so the generic toasts are off. */
export async function createSupportRequest(input: { kind: SupportKind; subject: string; body: string }): Promise<void> {
  await apiRequest("/api/support", { method: "POST", silent: true, body: input });
}

export async function listMySupportRequests(): Promise<MySupportRequest[]> {
  const dtos = await apiRequest<MySupportRequestDto[]>("/api/support/mine", { silent: true });
  return dtos.map((d) => ({
    id: d.id,
    kind: d.kind,
    subject: d.subject,
    body: d.body,
    status: d.status,
    createdAt: d.created_at,
    answer: d.answer,
    answeredAt: d.answered_at,
  }));
}
