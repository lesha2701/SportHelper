// frontend/src/components/coaches/CancelBooking.tsx
import { useEffect, useState } from "react";
import { cancelBooking, getCancelPreview } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { formatKopecks } from "../../lib/money";
import type { Booking, CancelPreview, Cancellation } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import confirmStyles from "../shared/ConfirmModal.module.css";
import styles from "./coaches.module.css";

export type CancelSide = "athlete" | "coach";

const MIN_COACH_REASON = 3;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** What the person is told BEFORE pressing the button, from the server's own calculation (the screen never works out the money itself). */
export function previewText(preview: CancelPreview, side: CancelSide): string {
  const refund = formatKopecks(preview.refundKopecks);
  switch (preview.policy) {
    case "unpaid":
      return "Запись не оплачена, поэтому отмена бесплатна: деньги не списывались.";
    case "athlete_early":
      return `Вернём ${preview.refundPercent}% — ${refund}. Деньги вернутся на карту, с которой вы платили. Бесплатная отмена возможна до ${formatDate(preview.freeCancelUntil ?? "")}.`;
    case "athlete_late":
      return `До занятия осталось слишком мало времени (бесплатная отмена была возможна до ${formatDate(preview.freeCancelUntil ?? "")}). Деньги не вернутся: оплата остаётся у тренера.`;
    case "coach":
      return side === "coach"
        ? `Игрок получит полный возврат — ${refund}. Комиссия платформы тоже возвращается, ваше начисление за это занятие снимается.`
        : `Вернём ${preview.refundPercent}% — ${refund}.`;
  }
}

/** The line about the money in the card of a cancelled booking, seen from the side of whoever reads it. */
export function refundLine(c: Cancellation, side: CancelSide): string | null {
  const sum = formatKopecks(c.refundAmountKopecks);
  if (c.policy === "unpaid") return null;
  if (c.policy === "athlete_late") return side === "coach" ? "Отмена меньше чем за срок бесплатной отмены: оплата осталась у вас." : "Деньги не возвращены: отмена пришла позже срока бесплатной отмены.";
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

/** Who cancelled and when, the reason and the money: shown in the card of a cancelled booking. */
export function CancellationNote({ cancellation, side }: { cancellation: Cancellation | null; side: CancelSide }) {
  if (!cancellation) return null;
  const who = cancellation.cancelledByRole === side ? "вами" : cancellation.cancelledByRole === "coach" ? "тренером" : "игроком";
  const line = refundLine(cancellation, side);
  return (
    <div className={styles.paymentBox}>
      <p className={styles.paymentDue}>
        Отменена {who} · {formatDate(cancellation.cancelledAt)}
      </p>
      {cancellation.reason && <p className={profileStyles.subtitle}>Причина: {cancellation.reason}</p>}
      {line && <p className={cancellation.refundStatus === "failed" ? profileStyles.error : profileStyles.subtitle}>{line}</p>}
    </div>
  );
}

/** «Отменить запись»: shown only when the server says it can be cancelled. The window first asks the server what the
 * cancellation means for the money, then cancels. The coach has to give a reason (the server insists too). */
export function CancelBooking({
  token,
  booking,
  side,
  onCancelled,
}: {
  token: string;
  booking: Booking;
  side: CancelSide;
  onCancelled: (updated: Booking) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setPreview(null);
    setLoadError(null);
    getCancelPreview(token, booking.id)
      .then((result) => current && setPreview(result))
      .catch((err: unknown) => current && setLoadError(err instanceof ApiError ? err.message : "Не удалось узнать условия отмены"));
    return () => {
      current = false;
    };
  }, [open, token, booking.id]);

  if (!booking.canCancel) return null;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  };

  const confirm = async () => {
    const text = reason.trim();
    if (side === "coach" && text.length < MIN_COACH_REASON) {
      setError(`Укажите причину отмены (не короче ${MIN_COACH_REASON} знаков): игрок увидит её.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await cancelBooking(token, booking.id, text || null);
      setOpen(false);
      onCancelled(updated);
    } catch (err) {
      // the API layer has already shown why it failed; keep the window open with the same words
      setError(err instanceof ApiError ? err.message : "Не удалось отменить запись. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.sessionActions} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => setOpen(true)}>
          Отменить запись
        </button>
      </div>
      {open && (
        <div className={confirmStyles.backdrop} role="dialog" aria-modal="true" aria-label="Отмена записи" onClick={(e) => e.stopPropagation()}>
          <div className={confirmStyles.sheet}>
            <h2 className={confirmStyles.title}>Отменить запись?</h2>
            <p className={confirmStyles.description}>
              {booking.listingTitle ? `${booking.listingTitle} · ` : ""}
              {formatDate(booking.startsAt)} · {side === "coach" ? booking.athleteFullName : booking.coachFullName}
            </p>
            {!preview && !loadError && <p className={profileStyles.subtitle}>Считаем условия отмены…</p>}
            {preview && <p className={confirmStyles.description}>{previewText(preview, side)}</p>}
            {loadError && <p className={profileStyles.error}>{loadError}</p>}
            {(preview || side === "coach") && !loadError && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>{side === "coach" ? "Причина (обязательно)" : "Причина (необязательно)"}</span>
                <textarea className={profileStyles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </label>
            )}
            {error && <p className={profileStyles.error}>{error}</p>}
            <div className={confirmStyles.actions}>
              <button type="button" className={confirmStyles.dangerButton} onClick={() => void confirm()} disabled={busy || !preview || loadError !== null}>
                {busy ? "…" : "Отменить запись"}
              </button>
              <button type="button" className={confirmStyles.cancelButton} onClick={close} disabled={busy}>
                Не отменять
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
