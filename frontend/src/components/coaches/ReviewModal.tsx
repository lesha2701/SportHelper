// frontend/src/components/coaches/ReviewModal.tsx
import { useState } from "react";
import { ApiError } from "../../api/client";
import type { ReviewInput } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

/** Stars + a short comment. Used both for the athlete's review of a coach and
 * the coach's review of an athlete — the caller supplies the wording and the
 * API call. */
export function ReviewModal({
  title,
  hint,
  submit,
  skipLabel = "Отмена",
  onClose,
  onSubmitted,
}: {
  title: string;
  hint?: string;
  submit: (input: ReviewInput) => Promise<void>;
  skipLabel?: string;
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
      await submit({ rating, text: text.trim() || null });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить отзыв");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={saving ? undefined : onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={profileStyles.title}>{title}</h2>
        {hint && <p className={profileStyles.subtitle}>{hint}</p>}

        <div className={styles.ratingPicker}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= rating ? `${styles.ratingStar} ${styles.ratingStarFilled}` : styles.ratingStar}
              onClick={() => setRating(n)}
              aria-label={`${n} из 5`}
              aria-pressed={n === rating}
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
            {skipLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
