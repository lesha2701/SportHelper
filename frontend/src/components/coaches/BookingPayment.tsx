import { useState } from "react";
import { openPaymentPage, startBookingPayment } from "../../api/payments";
import { ApiError } from "../../api/client";
import { usePaymentsEnabled } from "../../features";
import { DOCUMENTS } from "../../legal/documents";
import { formatKopecks } from "../../lib/money";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

const money = (amount: number, currency: string) => (currency === "RUB" ? formatKopecks(Math.round(amount * 100)) : `${amount} ${currency}`);

/** The payment block of a CONFIRMED booking. Which state it shows comes from the server (never from the address bar):
 * waiting for payment / being processed / paid / cancelled / refund under way / refunded. Nothing for a free session or when the
 * shop is not connected. Pressing the button is the acceptance of the standard terms (the notice under it says so; the server records it). */
export function BookingPayment({ token, booking }: { token: string; booking: Booking }) {
  const paymentsEnabled = usePaymentsEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = booking.paymentStatus;

  if (booking.status !== "confirmed" || status === "not_required") return null;
  if (status === "paid") {
    return (
      <p className={styles.paymentPaid}>
        Оплачено{booking.pricePerSession !== null ? ` · ${money(booking.pricePerSession, booking.currency)}` : ""}
      </p>
    );
  }
  if (status === "refund_pending") return <p className={styles.paymentNote}>Возврат обрабатывается. Деньги вернутся на карту, с которой вы платили.</p>;
  if (status === "refunded") return <p className={styles.paymentNote}>Возвращено. Деньги вернулись на карту, с которой вы платили.</p>;
  if (!paymentsEnabled || booking.pricePerSession === null) return null;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { confirmationUrl } = await startBookingPayment(token, booking.id);
      openPaymentPage(confirmationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? `Ошибка оплаты. ${err.message}` : "Ошибка оплаты. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  return (
    <div className={styles.paymentBox} onClick={(e) => e.stopPropagation()}>
      <p className={styles.paymentDue}>
        {status === "unpaid" && "Ожидает оплаты · "}К оплате: {money(booking.pricePerSession, booking.currency)}
      </p>
      {status === "processing" && (
        <p className={profileStyles.subtitle}>Оплата обрабатывается. Если вы не завершили её, нажмите кнопку ещё раз.</p>
      )}
      {status === "canceled" && <p className={profileStyles.subtitle}>Платёж отменён — деньги не списаны. Можно попробовать ещё раз.</p>}
      <button type="button" className={profileStyles.buttonPrimary} onClick={() => void pay()} disabled={busy}>
        {busy ? "Переходим к оплате…" : "Оплатить эту тренировку"}
      </button>
      {error && <p className={profileStyles.error}>{error}</p>}
      <p className={styles.paymentNotice}>
        Нажимая «Оплатить», вы заключаете договор с Тренером на{" "}
        <a href={DOCUMENTS["service-terms"].path} target="_blank" rel="noopener noreferrer">
          Типовых условиях оказания услуг тренером
        </a>
        . Платформа принимает оплату как агент Тренера и не является исполнителем услуги.
      </p>
    </div>
  );
}
