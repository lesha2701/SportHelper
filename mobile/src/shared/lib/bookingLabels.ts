import type { BookingStatus, PaymentStatus } from "../types/booking";

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Ждёт подтверждения тренера",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  expired: "Истёк срок ответа",
  cancelled: "Отменена",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_required: "Бесплатно",
  unpaid: "Ждёт оплаты",
  processing: "Оплата в процессе",
  paid: "Оплачено",
  canceled: "Оплата не прошла",
  refund_pending: "Возврат в обработке",
  refunded: "Деньги возвращены",
};

/** A confirmed, paid session cannot be paid again; an unpaid or failed one can. */
export function canPay(status: BookingStatus, payment: PaymentStatus): boolean {
  return status === "confirmed" && (payment === "unpaid" || payment === "canceled" || payment === "processing");
}

/** "5 нояб., 18:00". Booking times are kept and shown in UTC, exactly as the website does, so both show the same hour
 * (the coach's weekly hours are UTC hours on the server). */
export function formatStart(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
