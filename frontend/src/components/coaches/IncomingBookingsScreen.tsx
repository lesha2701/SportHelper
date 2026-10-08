// frontend/src/components/coaches/IncomingBookingsScreen.tsx
import { useEffect, useState } from "react";
import { confirmBooking, declineBooking, listCoachPendingBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { NextStepCard } from "../shared/NextStepCard";
import { TrainingDetail } from "../trainings/TrainingDetail";
import { PlayerPublicProfileScreen } from "./PlayerPublicProfileScreen";
import type { PendingBooking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bookings: PendingBooking[] };

type LastResult = { kind: "confirmed"; trainingId: string | null; athleteName: string } | { kind: "declined"; athleteName: string };

export function IncomingBookingsScreen({
  token,
  onBack,
  focusBookingId,
}: {
  token: string;
  onBack: () => void;
  /** Highlights this request (opened from its notification). */
  focusBookingId?: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [openTrainingId, setOpenTrainingId] = useState<string | null>(null);

  const load = () => {
    listCoachPendingBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить заявки" }),
      );
  };

  useEffect(load, [token]);

  if (viewingPlayerId) {
    return <PlayerPublicProfileScreen token={token} playerUserId={viewingPlayerId} onBack={() => setViewingPlayerId(null)} />;
  }

  if (openTrainingId) {
    // Back returns to this request list (the confirmation card stays on top of it).
    return (
      <TrainingDetail token={token} trainingId={openTrainingId} canEdit={false} onBack={() => setOpenTrainingId(null)} onEdit={() => {}} />
    );
  }

  const respond = async (bookingId: string, action: "confirm" | "decline") => {
    setBusyId(bookingId);
    setActionError(null);
    try {
      const athleteName = state.status === "ready" ? (state.bookings.find((b) => b.id === bookingId)?.athleteFullName ?? "") : "";
      if (action === "confirm") {
        // The response carries the training the confirmation just created.
        const confirmed = await confirmBooking(token, bookingId);
        setLastResult({ kind: "confirmed", trainingId: confirmed.trainingId, athleteName });
      } else {
        await declineBooking(token, bookingId);
        setLastResult({ kind: "declined", athleteName });
      }
      if (state.status === "ready") {
        setState({ status: "ready", bookings: state.bookings.filter((b) => b.id !== bookingId) });
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось обработать заявку");
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка заявок…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить заявки" description={state.message} />;

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <h1 className={profileStyles.pageHeading}>Входящие заявки</h1>

      {lastResult?.kind === "confirmed" && (
        <NextStepCard
          title="Заявка подтверждена"
          message={`Личная тренировка с ${lastResult.athleteName} создана и уже в календарях у вас обоих.`}
          primary={lastResult.trainingId ? { label: "Открыть тренировку", onClick: () => setOpenTrainingId(lastResult.trainingId) } : undefined}
          secondary={{ label: "К списку заявок", onClick: () => setLastResult(null) }}
        />
      )}
      {lastResult?.kind === "declined" && (
        <NextStepCard
          title="Заявка отклонена"
          message={`Игрок ${lastResult.athleteName} получит уведомление.`}
          primary={{ label: "К списку заявок", onClick: () => setLastResult(null) }}
        />
      )}

      {focusBookingId && !lastResult && state.status === "ready" && !state.bookings.some((b) => b.id === focusBookingId) && (
        <div className={profileStyles.card}>
          <p className={profileStyles.subtitle}>Эта заявка уже обработана. Подтверждённые занятия — в «Профиль → Записи».</p>
        </div>
      )}

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {state.bookings.length === 0 && (
        <div className={profileStyles.card}>
          <p className={profileStyles.subtitle}>Нет заявок, ожидающих ответа.</p>
          <p className={profileStyles.subtitle}>Когда игроки запишутся на ваши объявления, заявки появятся здесь.</p>
        </div>
      )}

      {state.bookings.map((b) => (
        <div
          className={profileStyles.card}
          key={b.id}
          ref={b.id === focusBookingId ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
          style={b.id === focusBookingId ? { outline: "2px solid var(--color-primary)" } : undefined}
        >
          <button type="button" className={styles.bookingAthleteName} onClick={() => setViewingPlayerId(b.athleteUserId)}>
            {b.athleteFullName}
          </button>
          <span className={b.athleteRatingAverage !== null && b.athleteRatingAverage < 3 ? `${styles.ratingChip} ${styles.ratingChipLow}` : styles.ratingChip}>
            {b.athleteRatingAverage !== null
              ? `★ ${b.athleteRatingAverage.toFixed(1)} · отзывов тренеров: ${b.athleteReviewCount}`
              : "Отзывов тренеров пока нет"}
          </span>
          {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
          <p className={profileStyles.subtitle}>
            {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
          </p>
          {b.athleteNotes && <p className={styles.bookingNotes}>Пожелания: {b.athleteNotes}</p>}

          <div className={styles.incomingActions}>
            <button
              type="button"
              className={profileStyles.buttonPrimary}
              disabled={busyId === b.id}
              onClick={() => void respond(b.id, "confirm")}
            >
              Подтвердить
            </button>
            <button
              type="button"
              className={profileStyles.buttonSecondary}
              disabled={busyId === b.id}
              onClick={() => void respond(b.id, "decline")}
            >
              Отклонить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
