export type NotificationCategory =
  | "training_reminder"
  | "task_deadline"
  | "new_training"
  | "new_match"
  | "new_task"
  | "booking_requested"
  | "booking_decided";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  training_reminder: "Напоминания о тренировках",
  task_deadline: "Напоминания о дедлайнах заданий",
  new_training: "Новые тренировки в команде",
  new_match: "Новые матчи",
  new_task: "Новые задания",
  booking_requested: "Новые заявки на тренировку (для тренера)",
  booking_decided: "Статус моих заявок на тренировку",
};

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
}

export interface NotificationItemDto {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  send_at: string;
  read_at: string | null;
}

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  sendAt: string;
  readAt: string | null;
}

export function mapNotificationItemDto(dto: NotificationItemDto): NotificationItem {
  return {
    id: dto.id,
    category: dto.category,
    title: dto.title,
    body: dto.body,
    entityType: dto.entity_type,
    entityId: dto.entity_id,
    sendAt: dto.send_at,
    readAt: dto.read_at,
  };
}
