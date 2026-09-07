// frontend/src/components/coaches/MyBookingsSection.tsx
import { useEffect, useState } from "react";
import { listMyBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";
import { ReviewModal } from "./ReviewModal";

export function MyBookingsSection({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: Booking[] }>({
    status: "loading",
  });
  const [reviewing, setReviewing] = useState<Booking | null>(null);

  useEffect(() => {
    listMyBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить брони" }));
  }, [token]);

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка броней…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить брони" description={state.message} />;

  const upcoming = state.bookings.filter((b) => !b.isCompleted && b.status === "confirmed");
  const past = state.bookings.filter((b) => b.isCompleted);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Мои брони</h1>

        <h2 className={profileStyles.title}>Предстоящие</h2>
        {upcoming.length === 0 && <p className={profileStyles.subtitle}>Нет предстоящих броней.</p>}
        {upcoming.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.coachFullName}</p>
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            <span className={styles.bookingStatus}>Подтверждена</span>
          </div>
        ))}

        <h2 className={profileStyles.title}>Прошедшие</h2>
        {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших броней.</p>}
        {past.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.coachFullName}</p>
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            {b.hasReview ? (
              <span className={styles.bookingStatus}>Есть отзыв</span>
            ) : (
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setReviewing(b)}>
                Оставить отзыв
              </button>
            )}
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          token={token}
          booking={reviewing}
          onClose={() => setReviewing(null)}
          onSubmitted={() => {
            setReviewing(null);
            // Re-fetch so hasReview flips and the button becomes the "Есть отзыв" badge.
            listMyBookings(token).then((bookings) => setState({ status: "ready", bookings }));
          }}
        />
      )}
    </div>
  );
}
