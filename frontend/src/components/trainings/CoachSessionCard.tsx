import { useEffect, useState } from "react";
import { getCoachBookingByTraining } from "../../api/bookings";
import type { Booking } from "../../types/booking";
import { CoachSessionActions } from "../coaches/CoachSessionActions";
import profileStyles from "../profile/profile.module.css";

/** On a booked personal training, the coach's "Тренировка проведена" / review
 * of the athlete. Renders nothing if there's no booking of theirs behind it. */
export function CoachSessionCard({
  token,
  trainingId,
  onOpenPlayer,
}: {
  token: string;
  trainingId: string;
  onOpenPlayer?: (playerUserId: string) => void;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);

  useEffect(() => {
    getCoachBookingByTraining(token, trainingId)
      .then(setBooking)
      .catch(() => setBooking(null));
  }, [token, trainingId]);

  if (booking === null) return null;
  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Занятие с {booking.athleteFullName}</h2>
      <CoachSessionActions token={token} booking={booking} onChange={setBooking} />
      {onOpenPlayer && (
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => onOpenPlayer(booking.athleteUserId)}>
          Посмотреть профиль игрока
        </button>
      )}
    </div>
  );
}
