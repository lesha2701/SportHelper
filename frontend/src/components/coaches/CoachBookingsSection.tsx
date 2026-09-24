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
import { PlanPickerModal } from "./PlanPickerModal";
import { PlayerPublicProfileScreen } from "./PlayerPublicProfileScreen";

/** The coach's own session list — who is booked and when. Separate from
 * IncomingBookingsScreen (pending requests needing accept/decline) and
 * from MyBookingsSection (the athlete-side "Мои брони"): this shows
 * confirmed/past/declined bookings from the coach's side, with the
 * athlete's name instead of the coach's. */
export function CoachBookingsSection({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: Booking[] }>({
    status: "loading",
  });
  const [planPickerFor, setPlanPickerFor] = useState<Booking | null>(null);
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  useEffect(() => {
    listCoachBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить записи" }));
  }, [token]);

  const updateBooking = (updated: Booking) => {
    if (state.status !== "ready") return;
    setState({ status: "ready", bookings: state.bookings.map((b) => (b.id === updated.id ? updated : b)) });
  };

  if (viewingPlayerId) {
    return <PlayerPublicProfileScreen token={token} playerUserId={viewingPlayerId} onBack={() => setViewingPlayerId(null)} />;
  }

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
          <div className={styles.bookingRowStack} key={b.id}>
            <div className={styles.bookingRowTop}>
              <div>
                <button
                  type="button"
                  className={profileStyles.rowValue}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", textDecoration: "underline" }}
                  onClick={() => setViewingPlayerId(b.athleteUserId)}
                >
                  {b.athleteFullName}
                </button>
                {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                <p className={profileStyles.subtitle}>
                  {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
                </p>
              </div>
              <span className={styles.bookingStatus}>Подтверждена</span>
            </div>
            {b.athleteNotes && <p className={styles.bookingNotes}>Пожелания: {b.athleteNotes}</p>}
            <div className={styles.bookingPlanRow}>
              <span className={styles.bookingPlanLabel}>
                {b.trainingPlanName ? `План: ${b.trainingPlanName}` : "План не выбран"}
              </span>
              <button type="button" className={styles.bookingPlanAction} onClick={() => setPlanPickerFor(b)}>
                {b.trainingPlanName ? "Изменить" : "Выбрать план"}
              </button>
            </div>
          </div>
        ))}

        <h2 className={profileStyles.title}>Прошедшие</h2>
        {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших записей.</p>}
        {past.map((b) => (
          <div className={styles.bookingRowStack} key={b.id}>
            <div className={styles.bookingRowTop}>
              <div>
                <button
                  type="button"
                  className={profileStyles.rowValue}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", textDecoration: "underline" }}
                  onClick={() => setViewingPlayerId(b.athleteUserId)}
                >
                  {b.athleteFullName}
                </button>
                {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
              </div>
              <span className={styles.bookingStatusMuted}>{b.hasReview ? "Есть отзыв" : "Завершена"}</span>
            </div>
            {b.athleteNotes && <p className={styles.bookingNotes}>Пожелания: {b.athleteNotes}</p>}
            <div className={styles.bookingPlanRow}>
              <span className={styles.bookingPlanLabel}>
                {b.trainingPlanName ? `План: ${b.trainingPlanName}` : "План не выбран"}
              </span>
              <button type="button" className={styles.bookingPlanAction} onClick={() => setPlanPickerFor(b)}>
                {b.trainingPlanName ? "Изменить" : "Выбрать план"}
              </button>
            </div>
          </div>
        ))}

        {declinedOrExpired.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Отклонённые</h2>
            {declinedOrExpired.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <button
                  type="button"
                  className={profileStyles.rowValue}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", textDecoration: "underline" }}
                  onClick={() => setViewingPlayerId(b.athleteUserId)}
                >
                  {b.athleteFullName}
                </button>
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

      {planPickerFor && (
        <PlanPickerModal
          token={token}
          booking={planPickerFor}
          onClose={() => setPlanPickerFor(null)}
          onSaved={(updated) => {
            updateBooking(updated);
            setPlanPickerFor(updated);
          }}
        />
      )}
    </div>
  );
}
