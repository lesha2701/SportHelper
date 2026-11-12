import type { BookingStatus, PaymentStatus } from "../types/booking";

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Ждёт подтверждения тренера",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  expired: "Истёк срок ответа",
  cancelled: "Отменена",
};

/** A status this version does not know yet must not break a list: it is shown as an update in progress, never as an error. */
export function bookingStatusLabel(status: string): string {
  return (BOOKING_STATUS_LABELS as Record<string, string>)[status] ?? "Статус обновляется";
}

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

/** Free times grouped by day (UTC, like the rest of the booking times), days in order, times in order. */
export function groupSlotsByDay<T extends { startsAt: string }>(slots: T[]): { day: string; slots: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = slot.startsAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }
  return [...byDay.entries()].map(([day, list]) => ({ day, slots: list }));
}

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** The two lines of a day chip: "пт" and "6 ноя". */
export function dayChip(day: string): { weekday: string; date: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return { weekday: WEEKDAYS_SHORT[d.getUTCDay()]!, date: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` };
}

/** "10:00" of a booking time (UTC, as the website shows it). */
export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
