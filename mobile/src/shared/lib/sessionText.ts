import type { SessionConfirmation, SessionProblemKind } from "../types/booking";
import { formatStart } from "./bookingLabels";

export type ConfirmSide = "athlete" | "coach";

export const PROBLEM_LABELS: Record<SessionProblemKind, string> = {
  athlete_no_show: "Игрок не пришёл",
  coach_no_show: "Тренер не пришёл",
  not_conducted: "Тренировка не состоялась",
  other: "Другое",
};

/** What each side may report (the server checks the same). */
export const PROBLEMS_OF: Record<ConfirmSide, SessionProblemKind[]> = {
  athlete: ["coach_no_show", "not_conducted", "other"],
  coach: ["athlete_no_show", "other"],
};

/** A real moment (when a code stops working): in the reader's own time. */
export function formatMoment(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** The code as it is read aloud: «482 913». */
export function formatCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The line about whether the session took place, seen from the side of whoever reads it (null where there is nothing to say yet). */
export function confirmationLine(c: SessionConfirmation, side: ConfirmSide): string | null {
  const auto = formatStart(c.windowClosesAt);
  switch (c.state) {
    case "scheduled":
      return null;
    case "awaiting":
      return side === "athlete"
        ? `Тренировка прошла? Подтвердите её или сообщите о проблеме. Без ответа подтвердится автоматически ${auto}.`
        : `Ждём подтверждения игрока. Без ответа тренировка подтвердится автоматически ${auto}.`;
    case "confirmed":
      if (c.confirmedMethod === "code") return "Тренировка подтверждена кодом игрока.";
      return side === "athlete" ? "Вы подтвердили тренировку." : "Игрок подтвердил тренировку.";
    case "auto_confirmed":
      return "Тренировка подтверждена автоматически.";
    case "disputed": {
      const what = c.disputeKind ? PROBLEM_LABELS[c.disputeKind].toLowerCase() : "проблема";
      if (c.disputedByRole === side) return `Вы сообщили: ${what}. Решение примет администратор.`;
      const who = c.disputedByRole === "coach" ? "Тренер" : "Игрок";
      return side === "athlete"
        ? `${who} сообщил: ${what}. Решение примет администратор; если это не так — напишите в поддержку.`
        : `${who} сообщил: ${what}. Оплата заморожена до решения администратора.`;
    }
    case "resolved_released":
      return side === "athlete" ? "Спор решён: оплата осталась у тренера." : "Спор решён: оплата за занятие ваша.";
    case "resolved_refunded":
      return side === "athlete" ? "Спор решён: деньги возвращаются вам." : "Спор решён: деньги возвращены игроку.";
    default:
      return "Ожидает подтверждения.";
  }
}
