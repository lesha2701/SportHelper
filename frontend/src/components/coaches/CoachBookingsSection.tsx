// frontend/src/components/coaches/CoachBookingsSection.tsx
import { useEffect, useState, type ReactNode } from "react";
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

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function BookingCard({
  booking,
  statusBadge,
  showPlanRow,
  onOpenPlayer,
  onOpenPlan,
}: {
  booking: Booking;
  statusBadge: ReactNode;
  showPlanRow: boolean;
  onOpenPlayer: (userId: string) => void;
  onOpenPlan: (booking: Booking) => void;
}) {
  return (
    <div className={profileStyles.card}>
      <div className={styles.bookingCardTop}>
        <div>
          <button type="button" className={styles.bookingAthleteName} onClick={() => onOpenPlayer(booking.athleteUserId)}>
            {booking.athleteFullName}
          </button>
          {booking.listingTitle && <p className={profileStyles.subtitle}>{booking.listingTitle}</p>}
          <p className={profileStyles.subtitle}>
            {formatDate(booking.startsAt)} · {booking.format === "online" ? "Онлайн" : "Очно"}
          </p>
        </div>
        {statusBadge}
      </div>
      {booking.athleteNotes && <p className={styles.bookingNotes}>Пожелания: {booking.athleteNotes}</p>}
      {showPlanRow && (
        <div className={styles.bookingPlanRow}>
          <span className={styles.bookingPlanLabel}>
            {booking.trainingPlanName ? `План: ${booking.trainingPlanName}` : "План не выбран"}
          </span>
          <button type="button" className={styles.bookingPlanAction} onClick={() => onOpenPlan(booking)}>
            {booking.trainingPlanName ? "Изменить" : "Выбрать план"}
          </button>
        </div>
      )}
    </div>
  );
}

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

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <h1 className={profileStyles.pageHeading}>Записи</h1>

      <h2 className={profileStyles.title}>Предстоящие</h2>
      {upcoming.length === 0 && <p className={profileStyles.subtitle}>Нет предстоящих записей.</p>}
      {upcoming.map((b) => (
        <BookingCard
          key={b.id}
          booking={b}
          statusBadge={<span className={styles.bookingStatus}>Подтверждена</span>}
          showPlanRow
          onOpenPlayer={setViewingPlayerId}
          onOpenPlan={setPlanPickerFor}
        />
      ))}

      <h2 className={profileStyles.title}>Прошедшие</h2>
      {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших записей.</p>}
      {past.map((b) => (
        <BookingCard
          key={b.id}
          booking={b}
          statusBadge={<span className={styles.bookingStatusMuted}>{b.hasReview ? "Есть отзыв" : "Завершена"}</span>}
          showPlanRow
          onOpenPlayer={setViewingPlayerId}
          onOpenPlan={setPlanPickerFor}
        />
      ))}

      {declinedOrExpired.length > 0 && (
        <>
          <h2 className={profileStyles.title}>Отклонённые</h2>
          {declinedOrExpired.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              statusBadge={
                <span className={styles.bookingStatusMuted}>
                  {b.status === "declined" ? "Отклонена вами" : "Истекла — не рассмотрена вовремя"}
                </span>
              }
              showPlanRow={false}
              onOpenPlayer={setViewingPlayerId}
              onOpenPlan={setPlanPickerFor}
            />
          ))}
        </>
      )}

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
