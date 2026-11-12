import type { CancelPreview, Cancellation } from "../types/booking";
import { formatStart } from "./bookingLabels";
import { formatKopecks } from "./money";

export type CancelSide = "athlete" | "coach";

/** A coach has to give a reason of at least this many characters (the server insists too). */
export const MIN_COACH_REASON = 3;

/** A real moment (when the booking was cancelled): shown in the reader's own time. */
export function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** What the person is told BEFORE pressing the button, from the server's own calculation (the screen never works out the money itself). */
export function previewText(preview: CancelPreview, side: CancelSide): string {
  const refund = formatKopecks(preview.refundKopecks);
  const until = preview.freeCancelUntil ? formatStart(preview.freeCancelUntil) : "";
  switch (preview.policy) {
    case "unpaid":
      return "Запись не оплачена, поэтому отмена бесплатна: деньги не списывались.";
    case "athlete_early":
      return `Вернём ${preview.refundPercent}% — ${refund}. Деньги вернутся на карту, с которой вы платили.${until ? ` Бесплатная отмена возможна до ${until}.` : ""}`;
    case "athlete_late":
      return `До занятия осталось слишком мало времени${until ? ` (бесплатная отмена была возможна до ${until})` : ""}. Деньги не вернутся: оплата остаётся у тренера.`;
    case "coach":
      return side === "coach"
        ? `Игрок получит полный возврат — ${refund}. Комиссия платформы тоже возвращается, ваше начисление за это занятие снимается.`
        : `Вернём ${preview.refundPercent}% — ${refund}.`;
    default:
      // a rule this version does not know yet: say nothing about the money, the server will do the right thing
      return "Запись будет отменена. Что будет с деньгами, покажет карточка записи после отмены.";
  }
}

/** The line about the money in the card of a cancelled booking, seen from the side of whoever reads it. */
export function refundLine(c: Cancellation, side: CancelSide): string | null {
  const sum = formatKopecks(c.refundAmountKopecks);
  // «unpaid» needs no line of its own: nothing was charged, unless the athlete paid afterwards (the refund of that payment is told below)
  if (c.policy === "athlete_late") {
    return side === "coach" ? "Отмена меньше чем за срок бесплатной отмены: оплата осталась у вас." : "Деньги не возвращены: отмена пришла позже срока бесплатной отмены.";
  }
  switch (c.refundStatus) {
    case "pending":
      return side === "coach" ? `Игроку возвращается ${sum}.` : `Возврат ${sum} обрабатывается. Деньги вернутся на карту, с которой вы платили.`;
    case "succeeded":
      return side === "coach" ? `Игроку возвращено ${sum}.` : `Возвращено ${sum} на карту, с которой вы платили.`;
    case "failed":
      return "Банк не принял возврат. Администратор разберётся вручную — если вопрос не решится, напишите в поддержку.";
    default:
      return null;
  }
}

/** «Отменена вами · 5 нояб., 18:00» / «Отменена тренером …» / «Отменена игроком …». */
export function cancelledBy(c: Cancellation, side: CancelSide): string {
  const who = c.cancelledByRole === side ? "вами" : c.cancelledByRole === "coach" ? "тренером" : "игроком";
  return `Отменена ${who} · ${formatMoment(c.cancelledAt)}`;
}
