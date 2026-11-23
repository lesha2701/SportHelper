import type { Booking, PendingBooking } from "@/shared/types/booking";
import { Notice } from "@/ui/Notice";

export function MatchBookingNote({ booking, side }: { booking: Booking | PendingBooking; side: "athlete" | "coach" }) {
  if (!booking.fromMatch) return null;
  if (side === "athlete") return <Notice>Запись из подбора. Первое занятие нужно оплатить в приложении. После оплаты откроется чат с тренером.</Notice>;
  return (
    <Notice>
      Запись из подбора.{booking.matchPercent !== null ? ` Комиссия за первое занятие — ${booking.matchPercent}%.` : ""}
      {booking.athleteHidden ? " Профиль спортсмена и чат откроются после оплаты." : ""}
    </Notice>
  );
}
