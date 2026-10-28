import { useState } from "react";
import { openPaymentPage, rememberPaymentTrip, startBookingPayment } from "../../api/payments";
import { ApiError } from "../../api/client";
import { usePaymentsEnabled } from "../../features";
import { DOCUMENTS } from "../../legal/documents";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

/** The «Оплатить эту тренировку» block of a CONFIRMED booking: nothing for a free session or when the shop is not connected,
 * "Оплачено" once paid, otherwise the button that leads to the payment page. Pressing it is the acceptance of the standard
 * terms (the notice under the button says so; the server records it). */
export function BookingPayment({ token, booking }: { token: string; booking: Booking }) {
  const paymentsEnabled = usePaymentsEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (booking.status !== "confirmed" || booking.paymentStatus === "not_required") return null;
  if (booking.paymentStatus === "paid") {
    return (
      <p className={styles.paymentPaid}>
        Оплачено{booking.pricePerSession !== null ? ` · ${money(booking.pricePerSession, booking.currency)}` : ""}
      </p>
    );
  }
  if (!paymentsEnabled || booking.pricePerSession === null) return null;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { confirmationUrl } = await startBookingPayment(token, booking.id);
      rememberPaymentTrip(booking.id);
      openPaymentPage(confirmationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось открыть страницу оплаты. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  return (
    <div className={styles.paymentBox} onClick={(e) => e.stopPropagation()}>
      <p className={styles.paymentDue}>К оплате: {money(booking.pricePerSession, booking.currency)}</p>
      {booking.paymentStatus === "pending" && (
        <p className={profileStyles.subtitle}>Оплата начата. Если вы не завершили её, нажмите кнопку ещё раз.</p>
      )}
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
