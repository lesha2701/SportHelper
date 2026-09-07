// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { useEffect, useState } from "react";
import { listCoaches } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { CoachPublicProfileScreen } from "./CoachPublicProfileScreen";
import { BookingFlow } from "./BookingFlow";
import type { CoachCard, CoachListFilters, CoachPublicProfile } from "../../types/coach";
import type { Booking } from "../../types/booking";
import teamStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type View =
  | { screen: "list" }
  | { screen: "profile"; coachUserId: string }
  | { screen: "booking"; coach: CoachPublicProfile }
  | { screen: "confirmed"; booking: Booking };

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; coaches: CoachCard[] };

function CoachCardView({ coach, onOpen }: { coach: CoachCard; onOpen: () => void }) {
  return (
    <button type="button" className={styles.coachCard} onClick={onOpen}>
      <div className={styles.coachCardTop}>
        {coach.photoUrl ? (
          <img className={styles.coachAvatar} src={coach.photoUrl} alt="" />
        ) : (
          <div className={styles.coachAvatar}>{coach.fullName.charAt(0).toUpperCase()}</div>
        )}
        <div>
          <h3 className={styles.coachName}>{coach.fullName}</h3>
          <p className={styles.coachMeta}>
            {coach.sport}
            {coach.experienceYears !== null ? ` · ${coach.experienceYears} лет опыта` : ""}
          </p>
          {coach.averageRating !== null && (
            <p className={styles.coachMeta}>
              <span className={styles.starRating}>★ {coach.averageRating.toFixed(1)}</span> ({coach.reviewCount})
            </p>
          )}
        </div>
      </div>

      {coach.description && <p className={styles.coachDescription}>{coach.description}</p>}

      <div className={styles.coachFooterRow}>
        <span className={styles.coachPrice}>
          {coach.pricePerSession !== null ? `${coach.pricePerSession} ${coach.currency}` : "Цена не указана"}
        </span>
        {coach.location && (
          <span className={teamStyles.teamMeta}>
            <Icon name="map-pin" size={13} /> {coach.location}
          </span>
        )}
      </div>
    </button>
  );
}

export function CoachMarketplaceScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [sport, setSport] = useState("");
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const load = (filters: CoachListFilters) => {
    setState({ status: "loading" });
    listCoaches(token, filters)
      .then((coaches) => setState({ status: "ready", coaches }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить список тренеров";
        setState({ status: "error", message });
      });
  };

  useEffect(() => {
    load({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applyFilters = () => {
    load({
      sport: sport.trim() || undefined,
      location: location.trim() || undefined,
      max_price: maxPrice ? Number(maxPrice) : undefined,
    });
  };

  if (view.screen === "profile") {
    return (
      <CoachPublicProfileScreen
        token={token}
        coachUserId={view.coachUserId}
        onBack={() => setView({ screen: "list" })}
        onBook={(coach) => setView({ screen: "booking", coach })}
      />
    );
  }

  if (view.screen === "booking") {
    return (
      <BookingFlow
        token={token}
        coach={view.coach}
        onBack={() => setView({ screen: "profile", coachUserId: view.coach.userId })}
        onBooked={(booking) => setView({ screen: "confirmed", booking })}
      />
    );
  }

  if (view.screen === "confirmed") {
    return (
      <div className={teamStyles.screen}>
        <div className={teamStyles.teamCard}>
          <div className={styles.successIcon}>
            <Icon name="check-circle" size={40} />
          </div>
          <h2 className={teamStyles.teamName}>Готово!</h2>
          <p className={teamStyles.teamMeta}>
            Бронь с {view.booking.coachFullName} на{" "}
            {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}{" "}
            подтверждена и добавлена в ваш календарь.
          </p>
          <button type="button" className={teamStyles.addButton} onClick={() => setView({ screen: "list" })}>
            К списку тренеров
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={teamStyles.screen}>
      <h1 className={teamStyles.heading}>Тренеры</h1>

      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          placeholder="Вид спорта"
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          onBlur={applyFilters}
        />
        <input
          className={styles.filterInput}
          placeholder="Город"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onBlur={applyFilters}
        />
        <input
          className={styles.filterInput}
          type="number"
          placeholder="Цена до"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          onBlur={applyFilters}
        />
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка тренеров…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить тренеров" description={state.message} onRetry={() => load({})} />}
      {state.status === "ready" && state.coaches.length === 0 && (
        <StateScreen kind="empty" title="Пока никого нет" description="Тренеры появятся здесь, когда включат листинг." />
      )}
      {state.status === "ready" && state.coaches.length > 0 && (
        <div className={teamStyles.cardGrid}>
          {state.coaches.map((coach) => (
            <CoachCardView key={coach.userId} coach={coach} onOpen={() => setView({ screen: "profile", coachUserId: coach.userId })} />
          ))}
        </div>
      )}
    </div>
  );
}
