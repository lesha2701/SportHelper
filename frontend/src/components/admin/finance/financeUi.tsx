import { useState } from "react";
import { ApiError } from "../../../api/client";
import { StepUpCancelled, useStepUp } from "../stepUp";
import { errorText } from "../adminUi";

export const money = (kopecks: number | null | undefined): string =>
  kopecks === null || kopecks === undefined ? "—" : new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(kopecks / 100);

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  awaiting: "Ждёт оплаты",
  paid: "Оплачен",
  partially_refunded: "Возвращён частично",
  refunded: "Возвращён",
};

export const EARNING_STATUS_LABELS: Record<string, string> = {
  pending: "Ждёт выплаты тренеру",
  held: "Заморожено",
  available: "Доступно тренеру",
  reversed: "Отменено",
};

export const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  requested: "Новая",
  under_review: "На проверке",
  approved: "Одобрена",
  processing: "Передана на выплату",
  paid: "Выплачена",
  rejected: "Отклонена",
  canceled: "Отменена тренером",
};

export const REFUND_STATUS_LABELS: Record<string, string> = { pending: "Обрабатывается", succeeded: "Выполнен", failed: "Не удался", canceled: "Отменён" };

export const INCIDENT_KIND_LABELS: Record<string, string> = {
  duplicate_payment: "Двойная оплата",
  amount_mismatch: "Сумма не совпала",
  paid_booking_closed: "Оплата по закрытой брони",
  paid_unexpected_state: "Оплата в неожиданном состоянии",
  reconcile_gap: "Платёж не удалось создать",
  refund_failed: "Возврат не прошёл",
  refund_mismatch: "Возврат не совпал",
  trainer_debt: "Долг тренера",
};

/** Runs one administrator action: marks it busy, asks for a fresh second-factor code when the server wants one, and turns a failure into text. */
export function useDoing(): { busy: boolean; error: string | null; clearError: () => void; doing: (action: () => Promise<unknown>, after?: () => void) => Promise<boolean> } {
  const stepUp = useStepUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doing = async (action: () => Promise<unknown>, after?: () => void): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await stepUp.run(action);
      after?.();
      return true;
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setError(err instanceof ApiError ? err.message : errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, clearError: () => setError(null), doing };
}
