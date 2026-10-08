import { useEffect, useState } from "react";
import { listMyBookings, reviewBooking } from "../../api/bookings";
import type { Booking } from "../../types/booking";
import { ReviewModal } from "../coaches/ReviewModal";
import profileStyles from "../profile/profile.module.css";

/** On the athlete's own booked personal training: once the session is
 * conducted, the way to review the coach is right here. Renders nothing for a
 * personal training that isn't a booking. */
export function AthleteSessionCard({ token, trainingId }: { token: string; trainingId: string }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    listMyBookings(token)
      .then((all) => setBooking(all.find((b) => b.trainingId === trainingId) ?? null))
      .catch(() => setBooking(null));
  }, [token, trainingId]);

  if (booking === null || booking.status !== "confirmed") return null;

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Занятие с тренером {booking.coachFullName}</h2>
      {booking.isCompleted && !booking.hasReview && (
        <>
          <p className={profileStyles.subtitle}>Занятие прошло. Оцените тренера — это поможет другим игрокам.</p>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setReviewing(true)}>
            Оставить отзыв
          </button>
        </>
      )}
      {booking.hasReview && <p className={profileStyles.subtitle}>✓ Вы оставили отзыв о тренере</p>}
      {!booking.isCompleted && (
        <p className={profileStyles.subtitle}>
          Отзыв можно оставить после занятия — когда тренер отметит его проведённым или когда пройдёт время занятия.
        </p>
      )}

      {reviewing && (
        <ReviewModal
          title={`Отзыв о тренере ${booking.coachFullName}`}
          hint="Оцените занятие и, если хотите, напишите пару слов — это поможет другим игрокам."
          submit={(input) => reviewBooking(token, booking.id, input)}
          onClose={() => setReviewing(false)}
          onSubmitted={() => {
            setReviewing(false);
            setBooking({ ...booking, hasReview: true });
          }}
        />
      )}
    </div>
  );
}
