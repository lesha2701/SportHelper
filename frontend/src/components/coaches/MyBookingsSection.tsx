// frontend/src/components/coaches/MyBookingsSection.tsx
import { useEffect, useState } from "react";
import { listMyBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { TrainingDetail } from "../trainings/TrainingDetail";
import { CoachPublicProfileScreen } from "./CoachPublicProfileScreen";
import { ListingPublicProfileScreen } from "./ListingPublicProfileScreen";
import { BookingFlow } from "./BookingFlow";
import type { Booking } from "../../types/booking";
import type { CoachListingProfile } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";
import { ReviewModal } from "./ReviewModal";

type CoachView =
  | { screen: "profile"; coachUserId: string }
  | { screen: "listing"; listingId: string; coachUserId: string }
  | { screen: "booking"; listing: CoachListingProfile }
  | { screen: "confirmed"; booking: Booking };

function CoachNameButton({ booking, onOpen }: { booking: Booking; onOpen: (coachUserId: string) => void }) {
  return (
    <button
      type="button"
      className={profileStyles.rowValue}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", textDecoration: "underline" }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(booking.coachUserId);
      }}
    >
      {booking.coachFullName}
    </button>
  );
}

export function MyBookingsSection({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: Booking[] }>({
    status: "loading",
  });
  const [reviewing, setReviewing] = useState<Booking | null>(null);
  const [openTrainingId, setOpenTrainingId] = useState<string | null>(null);
  const [coachView, setCoachView] = useState<CoachView | null>(null);

  useEffect(() => {
    listMyBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить брони" }));
  }, [token]);

  if (coachView?.screen === "profile") {
    return (
      <CoachPublicProfileScreen
        token={token}
        coachUserId={coachView.coachUserId}
        onBack={() => setCoachView(null)}
        onOpenListing={(listingId) => setCoachView({ screen: "listing", listingId, coachUserId: coachView.coachUserId })}
      />
    );
  }

  if (coachView?.screen === "listing") {
    return (
      <ListingPublicProfileScreen
        token={token}
        listingId={coachView.listingId}
        onBack={() => setCoachView({ screen: "profile", coachUserId: coachView.coachUserId })}
        onBook={(listing) => setCoachView({ screen: "booking", listing })}
      />
    );
  }

  if (coachView?.screen === "booking") {
    return (
      <BookingFlow
        token={token}
        listing={coachView.listing}
        onBack={() => setCoachView({ screen: "listing", listingId: coachView.listing.id, coachUserId: coachView.listing.coachUserId })}
        onBooked={(booking) => setCoachView({ screen: "confirmed", booking })}
      />
    );
  }

  if (coachView?.screen === "confirmed") {
    return (
      <div className={profileStyles.screen}>
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Заявка отправлена!</h2>
          <p className={profileStyles.subtitle}>
            Ждите подтверждения от тренера — статус появится здесь же, в «Мои брони».
          </p>
          <button
            type="button"
            className={profileStyles.buttonPrimary}
            onClick={() => {
              setCoachView(null);
              listMyBookings(token).then((bookings) => setState({ status: "ready", bookings }));
            }}
          >
            К моим броням
          </button>
        </div>
      </div>
    );
  }

  if (openTrainingId) {
    // canEdit=false: this training's schedule is driven by the booking, not
    // something the athlete should be able to change independently from it.
    return (
      <TrainingDetail
        token={token}
        trainingId={openTrainingId}
        canEdit={false}
        onBack={() => setOpenTrainingId(null)}
        onEdit={() => {}}
      />
    );
  }

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка броней…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить брони" description={state.message} />;

  const pending = state.bookings.filter((b) => b.status === "pending");
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
        <h1 className={profileStyles.pageHeading}>Мои брони</h1>

        {pending.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Ожидают подтверждения</h2>
            {pending.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <CoachNameButton booking={b} onOpen={(coachUserId) => setCoachView({ screen: "profile", coachUserId })} />
                  {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
                <span className={styles.bookingStatus}>Ожидает тренера</span>
              </div>
            ))}
          </>
        )}

        <h2 className={profileStyles.title}>Предстоящие</h2>
        {upcoming.length === 0 && <p className={profileStyles.subtitle}>Нет предстоящих броней.</p>}
        {upcoming.map((b) => (
          <div
            className={styles.bookingRow}
            key={b.id}
            style={b.trainingId ? { cursor: "pointer" } : undefined}
            onClick={() => b.trainingId && setOpenTrainingId(b.trainingId)}
          >
            <div>
              <CoachNameButton booking={b} onOpen={(coachUserId) => setCoachView({ screen: "profile", coachUserId })} />
              {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
              <p className={profileStyles.subtitle}>{b.trainingPlanName ? `План: ${b.trainingPlanName}` : "Тренер ещё не выбрал план"}</p>
            </div>
            <span className={styles.bookingStatus}>Подтверждена</span>
          </div>
        ))}

        <h2 className={profileStyles.title}>Прошедшие</h2>
        {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших броней.</p>}
        {past.map((b) => (
          <div
            className={styles.bookingRow}
            key={b.id}
            style={b.trainingId ? { cursor: "pointer" } : undefined}
            onClick={() => b.trainingId && setOpenTrainingId(b.trainingId)}
          >
            <div>
              <CoachNameButton booking={b} onOpen={(coachUserId) => setCoachView({ screen: "profile", coachUserId })} />
              {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            {b.hasReview ? (
              <span className={styles.bookingStatus}>Есть отзыв</span>
            ) : (
              <button
                type="button"
                className={profileStyles.buttonSecondary}
                onClick={(e) => {
                  e.stopPropagation();
                  setReviewing(b);
                }}
              >
                Оставить отзыв
              </button>
            )}
          </div>
        ))}

        {declinedOrExpired.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Отклонённые</h2>
            {declinedOrExpired.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <CoachNameButton booking={b} onOpen={(coachUserId) => setCoachView({ screen: "profile", coachUserId })} />
                  {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
                <span className={styles.bookingStatusMuted}>
                  {b.status === "declined" ? "Отклонена тренером" : "Истекла — тренер не ответил"}
                </span>
              </div>
            ))}
          </>
        )}
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
