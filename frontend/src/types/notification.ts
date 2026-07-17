export type NotificationCategory = "training_reminder" | "task_deadline" | "new_training" | "new_match" | "new_task";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  training_reminder: "Напоминания о тренировках",
  task_deadline: "Напоминания о дедлайнах заданий",
  new_training: "Новые тренировки в команде",
  new_match: "Новые матчи",
  new_task: "Новые задания",
};

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
}
