// frontend/src/components/coaches/CoachBookingsSection.tsx
import { useEffect, useState } from "react";
import { listCoachBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

/** The coach's own session list — who is booked and when. Separate from
 * IncomingBookingsScreen (pending requests needing accept/decline) and
 * from MyBookingsSection (the athlete-side "Мои брони"): this shows
 * confirmed/past/declined bookings from the coach's side, with the
 * athlete's name instead of the coach's. */
export function CoachBookingsSection({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: Booking[] }>({
    status: "loading",
  });

  useEffect(() => {
    listCoachBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить записи" }));
  }, [token]);

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка записей…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить записи" description={state.message} />;

  const upcoming = state.bookings.filter((b) => !b.isCompleted && b.status === "confirmed");
  const past = state.bookings.filter((b) => b.isCompleted);
  const declinedOrExpired = state.bookings.filter((b) => b.status === "declined" || b.status === "expired");

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
        <h1 className={profileStyles.pageHeading}>Записи</h1>

        <h2 className={profileStyles.title}>Предстоящие</h2>
        {upcoming.length === 0 && <p className={profileStyles.subtitle}>Нет предстоящих записей.</p>}
        {upcoming.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
              <p className={profileStyles.subtitle}>
                {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
              </p>
            </div>
            <span className={styles.bookingStatus}>Подтверждена</span>
          </div>
        ))}

        <h2 className={profileStyles.title}>Прошедшие</h2>
        {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших записей.</p>}
        {past.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            <span className={styles.bookingStatusMuted}>{b.hasReview ? "Есть отзыв" : "Завершена"}</span>
          </div>
        ))}

        {declinedOrExpired.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Отклонённые</h2>
            {declinedOrExpired.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
                  {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
                <span className={styles.bookingStatusMuted}>
                  {b.status === "declined" ? "Отклонена вами" : "Истекла — не рассмотрена вовремя"}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
