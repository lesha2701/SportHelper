import { useCallback, useEffect, useRef, useState } from "react";
import { syncBookingPayment } from "../../api/payments";
import { navigateApp } from "../../appNav";
import { navigate, useLocation } from "../../router";
import type { Booking, PaymentStatus } from "../../types/booking";
import { formatKopecks } from "../../lib/money";
import { StateScreen } from "../StateScreen";
import { PublicShell } from "../public/PublicShell";
import profileStyles from "../profile/profile.module.css";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_EVERY_MS = 3000;
const MAX_TRIES = 10;

type View = { kind: "checking" } | { kind: "error" } | { kind: "known"; booking: Booking };

const MESSAGES: Partial<Record<PaymentStatus, { title: string; text: string; tone: "ok" | "wait" | "bad" }>> = {
  paid: { title: "Оплата прошла успешно", text: "Спасибо! Мы получили оплату, тренировка оплачена.", tone: "ok" },
  processing: { title: "Проверяем оплату", text: "Банк ещё подтверждает платёж. Эта страница обновится сама, а статус всегда виден в «Моих бронях».", tone: "wait" },
  unpaid: { title: "Платёж не завершён", text: "Платёж не был завершён, деньги не списаны. Вы можете оплатить тренировку ещё раз в «Моих бронях».", tone: "bad" },
  canceled: { title: "Платёж не завершён", text: "Платёж отменён, деньги не списаны. Вы можете попробовать оплатить ещё раз в «Моих бронях».", tone: "bad" },
  refund_pending: { title: "Возврат обрабатывается", text: "По этой оплате оформлен возврат. Деньги вернутся на карту, с которой вы платили.", tone: "wait" },
  refunded: { title: "Возвращено", text: "Деньги по этой оплате возвращены.", tone: "ok" },
};

/** Where ЮKassa sends the customer back to. The result shown here is ALWAYS what our server says after asking ЮKassa - never
 * something read from the address (an address can say anything). */
export function PaymentReturnPage({ token }: { token: string }) {
  const { search } = useLocation();
  const bookingId = new URLSearchParams(search).get("booking");
  const [view, setView] = useState<View>({ kind: "checking" });
  const tries = useRef(0);

  const check = useCallback(() => {
    if (!bookingId || !UUID_SHAPE.test(bookingId)) return;
    syncBookingPayment(token, bookingId)
      .then((booking) => setView({ kind: "known", booking }))
      .catch(() => setView({ kind: "error" }));
  }, [token, bookingId]);

  useEffect(() => {
    tries.current = 0;
    setView({ kind: "checking" });
    check();
  }, [check]);

  // A payment that is still being confirmed is asked about again, a bounded number of times.
  const status = view.kind === "known" ? view.booking.paymentStatus : null;
  useEffect(() => {
    if (status !== "processing" || tries.current >= MAX_TRIES) return;
    const timer = window.setTimeout(() => {
      tries.current += 1;
      check();
    }, RETRY_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [status, view, check]);

  const goToBookings = () => {
    navigate("/");
    navigateApp({ kind: "my-bookings" });
  };

  if (!bookingId || !UUID_SHAPE.test(bookingId)) {
    return (
      <PublicShell>
        <StateScreen kind="empty" title="Не удалось определить оплату" description="В ссылке нет номера бронирования. Откройте «Мои брони» на сайте." />
      </PublicShell>
    );
  }
  if (view.kind === "checking") return <PublicShell><StateScreen kind="loading" title="Проверяем оплату…" /></PublicShell>;
  if (view.kind === "error") {
    return (
      <PublicShell>
        <StateScreen kind="error" title="Не удалось проверить оплату" description="Платёж мог пройти — не оплачивайте повторно, пока не проверите «Мои брони»." onRetry={check} />
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 40 }}>
          <button type="button" className={profileStyles.buttonSecondary} onClick={goToBookings}>
            Открыть «Мои брони»
          </button>
        </div>
      </PublicShell>
    );
  }

  const message = MESSAGES[view.booking.paymentStatus] ?? MESSAGES.unpaid!;
  return (
    <PublicShell>
      <div className={profileStyles.screen} style={{ maxWidth: 520, margin: "40px auto" }}>
        <div className={profileStyles.card} role="status" aria-live="polite">
          <h1 className={profileStyles.pageHeading}>{message.title}</h1>
          <p className={profileStyles.subtitle}>{message.text}</p>
          {view.booking.pricePerSession !== null && view.booking.paymentStatus === "paid" && (
            <p className={profileStyles.rowValue}>{formatKopecks(Math.round(view.booking.pricePerSession * 100))}</p>
          )}
          <div className={profileStyles.formActions}>
            <button type="button" className={profileStyles.buttonPrimary} onClick={goToBookings}>
              Открыть «Мои брони»
            </button>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
