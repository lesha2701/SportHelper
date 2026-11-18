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

/** A message after the first one: the administrators' answer (fromStaff) or the author's own reply. */
export interface SupportMessage {
  id: string;
  fromStaff: boolean;
  body: string;
  createdAt: string;
}

export interface MySupportRequest {
  id: string;
  kind: SupportKind;
  subject: string;
  body: string;
  status: SupportStatus;
  createdAt: string;
  messages: SupportMessage[];
  /** False once the request is closed or the conversation has reached its limit. */
  canReply: boolean;
}

interface MySupportRequestDto {
  id: string;
  kind: SupportKind;
  subject: string;
  body: string;
  status: SupportStatus;
  created_at: string;
  messages: { id: string; from_staff: boolean; body: string; created_at: string }[];
  can_reply: boolean;
}

function mapMine(d: MySupportRequestDto): MySupportRequest {
  return {
    id: d.id,
    kind: d.kind,
    subject: d.subject,
    body: d.body,
    status: d.status,
    createdAt: d.created_at,
    messages: d.messages.map((m) => ({ id: m.id, fromStaff: m.from_staff, body: m.body, createdAt: m.created_at })),
    canReply: d.can_reply,
  };
}

/** The form shows its own «спасибо» and its own error, so the generic toasts are off. */
export async function createSupportRequest(input: { kind: SupportKind; subject: string; body: string }): Promise<void> {
  await apiRequest("/api/support", { method: "POST", silent: true, body: input });
}

export async function listMySupportRequests(): Promise<MySupportRequest[]> {
  const dtos = await apiRequest<MySupportRequestDto[]>("/api/support/mine", { silent: true });
  return dtos.map(mapMine);
}

/** The author's next message in an existing request. The screen shows its own error, so the generic toast is off. */
export async function replyToSupportRequest(id: string, body: string): Promise<MySupportRequest> {
  return mapMine(await apiRequest<MySupportRequestDto>(`/api/support/${id}/messages`, { method: "POST", silent: true, body: { body } }));
}
