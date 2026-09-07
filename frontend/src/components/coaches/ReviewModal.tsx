// frontend/src/components/coaches/ReviewModal.tsx
import { useState } from "react";
import { reviewBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

export function ReviewModal({
  token,
  booking,
  onClose,
  onSubmitted,
}: {
  token: string;
  booking: Booking;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await reviewBooking(token, booking.id, { rating, text: text.trim() || null });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить отзыв");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={profileStyles.title}>Отзыв о тренере {booking.coachFullName}</h2>

        <div className={styles.ratingPicker}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= rating ? `${styles.ratingStar} ${styles.ratingStarFilled}` : styles.ratingStar}
              onClick={() => setRating(n)}
              aria-label={`${n} звёзд`}
            >
              ★
            </button>
          ))}
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Комментарий (необязательно)</span>
          <textarea className={profileStyles.textarea} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Отправка…" : "Отправить отзыв"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onClose} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
