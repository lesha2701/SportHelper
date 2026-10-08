import { useState } from "react";
import { completeBookingSession, reviewPlayer } from "../../api/bookings";
import { ApiError } from "../../api/client";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";
import { ReviewModal } from "./ReviewModal";

/** The coach's actions on a confirmed booked session: "Тренировка проведена"
 * (which opens reviews and asks the athlete to review the coach) and the
 * coach's own review of the athlete. Pressing "проведена" immediately offers
 * the athlete review window. */
export function CoachSessionActions({
  token,
  booking,
  onChange,
}: {
  token: string;
  booking: Booking;
  onChange: (updated: Booking) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  if (booking.status !== "confirmed" || booking.trainingStatus === "cancelled") return null;

  const started = new Date(booking.startsAt).getTime() <= Date.now();
  const canMarkConducted = booking.trainingStatus === "scheduled" && started;
  // While "проведена" is still to be pressed, that button is the way in: it opens the review right after.
  const canReview = booking.isCompleted && !booking.hasPlayerReview && !canMarkConducted;

  const markConducted = async () => {
    setBusy(true);
    try {
      const updated = await completeBookingSession(token, booking.id);
      onChange(updated);
      // Right away: "Поставьте отзыв" — the coach can also do it later.
      if (!updated.hasPlayerReview) setReviewOpen(true);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err; // the API layer already showed why it failed
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.sessionActions}>
      {canMarkConducted && (
        <>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void markConducted()} disabled={busy}>
            {busy ? "Сохраняю…" : "Тренировка проведена"}
          </button>
          <p className={profileStyles.subtitle}>
            После отметки игрок получит просьбу оценить вас, а вы сможете оставить отзыв об игроке.
          </p>
        </>
      )}
      {!canMarkConducted && booking.trainingStatus === "scheduled" && !started && (
        <p className={profileStyles.subtitle}>Кнопка «Тренировка проведена» появится, когда занятие начнётся.</p>
      )}
      {canReview && (
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => setReviewOpen(true)}>
          Оставить отзыв об игроке
        </button>
      )}
      {booking.hasPlayerReview && <p className={profileStyles.subtitle}>✓ Вы оставили отзыв об игроке</p>}

      {reviewOpen && (
        <ReviewModal
          title={`Поставьте отзыв: ${booking.athleteFullName}`}
          hint="Отзыв увидят другие тренеры, когда этот игрок запишется к ним. Пишите по делу и по фактам."
          skipLabel="Позже"
          submit={(input) => reviewPlayer(token, booking.id, input)}
          onClose={() => setReviewOpen(false)}
          onSubmitted={() => {
            setReviewOpen(false);
            onChange({ ...booking, hasPlayerReview: true, isCompleted: true });
          }}
        />
      )}
    </div>
  );
}
