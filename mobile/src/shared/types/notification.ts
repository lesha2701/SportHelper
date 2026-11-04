export type NotificationCategory =
  | "training_reminder"
  | "task_deadline"
  | "new_training"
  | "new_match"
  | "new_task"
  | "booking_requested"
  | "booking_decided"
  | "review_requested"
  | "training_nudge"
  | "payment_update"
  | "earning_update"
  | "withdrawal_update"
  | "finance_admin";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  training_reminder: "Напоминания о тренировках",
  task_deadline: "Напоминания о дедлайнах заданий",
  new_training: "Новые тренировки в команде",
  new_match: "Новые матчи",
  new_task: "Новые задания",
  booking_requested: "Новые заявки на тренировку (для тренера)",
  booking_decided: "Статус моих заявок на тренировку",
  review_requested: "Просьба оставить отзыв о тренере",
  training_nudge: "Напоминания «Пора потренироваться»",
  payment_update: "Статус оплаты тренировок",
  earning_update: "Поступления на баланс (для тренера)",
  withdrawal_update: "Статус заявок на вывод (для тренера)",
  finance_admin: "Финансовые события (для администратора)",
};

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
}
