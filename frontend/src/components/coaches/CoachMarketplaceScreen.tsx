// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { useEffect, useState } from "react";
import { listListings } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ListingPublicProfileScreen } from "./ListingPublicProfileScreen";
import { BookingFlow } from "./BookingFlow";
import type { CoachListingCard, CoachListingFilters, CoachListingProfile } from "../../types/coachListing";
import type { Booking } from "../../types/booking";
import teamStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type View =
  | { screen: "list" }
  | { screen: "profile"; listingId: string }
  | { screen: "booking"; listing: CoachListingProfile }
  | { screen: "confirmed"; booking: Booking };

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; listings: CoachListingCard[] };

function ListingCardView({ token, listing, onOpen }: { token: string; listing: CoachListingCard; onOpen: () => void }) {
  return (
    <button type="button" className={styles.coachCard} onClick={onOpen}>
      <div className={styles.coachCardTop}>
        {listing.coachPhotoUrl ? (
          <img className={styles.coachAvatar} src={listing.coachPhotoUrl} alt="" />
        ) : (
          <div className={styles.coachAvatar}>{listing.coachFullName.charAt(0).toUpperCase()}</div>
        )}
        <div>
          <h3 className={styles.coachName}>{listing.title}</h3>
          <p className={styles.coachMeta}>
            {listing.coachFullName} · {listing.sport}
            {listing.experienceYears !== null ? ` · ${listing.experienceYears} лет опыта` : ""}
          </p>
          {listing.averageRating !== null && (
            <p className={styles.coachMeta}>
              <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({listing.reviewCount})
            </p>
          )}
        </div>
      </div>

      <div className={styles.listingCardPhotoWrap}>
        {listing.photoFileId ? (
          <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={styles.listingCardPhoto} />
        ) : (
          <div className={styles.listingCardPhotoPlaceholder}>
            <Icon name="image" size={28} />
          </div>
        )}
      </div>

      <p className={styles.coachDescription}>{listing.description || " "}</p>

      <div className={styles.coachFooterRow}>
        <span className={styles.coachPrice}>
          {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена не указана"}
        </span>
        {listing.location && (
          <span className={teamStyles.teamMeta}>
            <Icon name="map-pin" size={13} /> {listing.location}
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

  const load = (filters: CoachListingFilters) => {
    setState({ status: "loading" });
    listListings(token, filters)
      .then((listings) => setState({ status: "ready", listings }))
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
      <ListingPublicProfileScreen
        token={token}
        listingId={view.listingId}
        onBack={() => setView({ screen: "list" })}
        onBook={(listing) => setView({ screen: "booking", listing })}
      />
    );
  }

  if (view.screen === "booking") {
    return (
      <BookingFlow
        token={token}
        listing={view.listing}
        onBack={() => setView({ screen: "profile", listingId: view.listing.id })}
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
          <h2 className={teamStyles.teamName}>Заявка отправлена!</h2>
          <p className={teamStyles.teamMeta}>
            Заявка{view.booking.listingTitle ? ` на «${view.booking.listingTitle}»` : ""} на{" "}
            {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}{" "}
            отправлена тренеру {view.booking.coachFullName}. Ждите подтверждения — статус можно посмотреть в «Мои
            брони» в профиле.
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
      {state.status === "ready" && state.listings.length === 0 && (
        <StateScreen kind="empty" title="Пока никого нет" description="Объявления появятся здесь, когда тренеры их опубликуют." />
      )}
      {state.status === "ready" && state.listings.length > 0 && (
        <div className={teamStyles.cardGrid}>
          {state.listings.map((listing) => (
            <ListingCardView
              key={listing.id}
              token={token}
              listing={listing}
              onOpen={() => setView({ screen: "profile", listingId: listing.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
