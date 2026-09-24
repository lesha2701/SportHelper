// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { useEffect, useState } from "react";
import { listListings } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ListingPublicProfileScreen } from "./ListingPublicProfileScreen";
import { CoachPublicProfileScreen } from "./CoachPublicProfileScreen";
import { BookingFlow } from "./BookingFlow";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import type { CoachListingCard, CoachListingFilters, CoachListingProfile } from "../../types/coachListing";
import type { Booking } from "../../types/booking";
import teamStyles from "../teams/teams.module.css";
import profileStyles from "../profile/profile.module.css";
import libStyles from "../library/library.module.css";
import styles from "./coaches.module.css";

type View =
  | { screen: "list" }
  | { screen: "coachProfile"; coachUserId: string }
  | { screen: "profile"; listingId: string; coachUserId: string }
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

function ListingDetailPanel({
  token,
  listing,
  onBook,
  onOpenProfile,
}: {
  token: string;
  listing: CoachListingCard;
  onBook: () => void;
  onOpenProfile: () => void;
}) {
  const format = [listing.offersOnline && "Онлайн", listing.offersOffline && "Очно"].filter(Boolean).join(" · ");

  return (
    <div className={libStyles.detailPanel}>
      <div className={libStyles.detailMedia}>
        {listing.photoFileId ? (
          <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={libStyles.detailMediaFill} />
        ) : (
          <Icon name="image" size={28} />
        )}
      </div>
      <div className={libStyles.detailBody}>
        <div>
          <span className={libStyles.detailCategory}>{listing.sport}</span>
          <h2 className={libStyles.detailTitle}>{listing.title}</h2>
        </div>
        <p className={profileStyles.subtitle} style={{ margin: 0 }}>
          {listing.coachFullName}
          {listing.experienceYears !== null ? ` · ${listing.experienceYears} лет опыта` : ""}
        </p>
        {listing.averageRating !== null && (
          <p className={profileStyles.subtitle} style={{ margin: 0 }}>
            <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({listing.reviewCount} отзывов)
          </p>
        )}
        <p className={libStyles.detailDescription}>{listing.description || "Без описания."}</p>

        <div className={libStyles.detailStatsGrid}>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{listing.pricePerSession ?? "—"}</span>
            <span className={libStyles.detailStatLabel}>{listing.pricePerSession !== null ? listing.currency : "цена"}</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue} style={{ fontSize: 15 }}>
              {format || "—"}
            </span>
            <span className={libStyles.detailStatLabel}>формат</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue} style={{ fontSize: 15 }}>
              {listing.location || "—"}
            </span>
            <span className={libStyles.detailStatLabel}>город</span>
          </div>
        </div>

        <div className={libStyles.detailActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onBook}>
            Записаться
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onOpenProfile}>
            Профиль
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_PRICE_CEILING = 5000;
const LISTINGS_LAYOUT_STORAGE_KEY = "coachMarketplaceListingsLayout";

type ListingsLayout = "column" | "grid3";

function loadStoredLayout(): ListingsLayout {
  try {
    const stored = window.localStorage.getItem(LISTINGS_LAYOUT_STORAGE_KEY);
    return stored === "grid3" ? "grid3" : "column";
  } catch {
    return "column";
  }
}

export function CoachMarketplaceScreen({ token }: { token: string }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<View>({ screen: "list" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE_CEILING);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [listingsLayout, setListingsLayout] = useState<ListingsLayout>(loadStoredLayout);

  const setLayout = (layout: ListingsLayout) => {
    setListingsLayout(layout);
    try {
      window.localStorage.setItem(LISTINGS_LAYOUT_STORAGE_KEY, layout);
    } catch {
      // Best-effort — a private-browsing tab or full storage just means the
      // choice doesn't persist across reloads, which is fine.
    }
  };

  // 3-per-row leaves no room for the master-detail side panel — clicking a
  // card there goes straight to the coach's profile, same as mobile.
  const showDetailPanel = isDesktop && listingsLayout === "column";

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

  const applyFilters = (overrides: Partial<{ location: string; maxPrice: number; minRating?: number; onlineOnly: boolean }> = {}) => {
    const next = {
      location: overrides.location ?? location,
      maxPrice: overrides.maxPrice ?? maxPrice,
      minRating: "minRating" in overrides ? overrides.minRating : minRating,
      onlineOnly: overrides.onlineOnly ?? onlineOnly,
    };
    load({
      location: next.location.trim() || undefined,
      max_price: next.maxPrice < MAX_PRICE_CEILING ? next.maxPrice : undefined,
      min_rating: next.minRating,
      format: next.onlineOnly ? "online" : undefined,
    });
  };

  const resetFilters = () => {
    setLocation("");
    setMaxPrice(MAX_PRICE_CEILING);
    setMinRating(undefined);
    setOnlineOnly(false);
    load({});
  };

  if (view.screen === "coachProfile") {
    return (
      <CoachPublicProfileScreen
        token={token}
        coachUserId={view.coachUserId}
        onBack={() => setView({ screen: "list" })}
        onOpenListing={(listingId) => setView({ screen: "profile", listingId, coachUserId: view.coachUserId })}
      />
    );
  }

  if (view.screen === "profile") {
    return (
      <ListingPublicProfileScreen
        token={token}
        listingId={view.listingId}
        onBack={() => setView({ screen: "coachProfile", coachUserId: view.coachUserId })}
        onBook={(listing) => setView({ screen: "booking", listing })}
      />
    );
  }

  if (view.screen === "booking") {
    return (
      <BookingFlow
        token={token}
        listing={view.listing}
        onBack={() => setView({ screen: "profile", listingId: view.listing.id, coachUserId: view.listing.coachUserId })}
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

      <div className={styles.marketplaceLayout}>
        <div className={styles.filterPanel}>
          <h2 className={styles.filterPanelTitle}>Фильтры</h2>

          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Город</span>
            <input
              className={styles.filterFieldInput}
              placeholder="Например, Москва"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => applyFilters()}
            />
          </div>

          <div className={styles.filterField}>
            <div className={styles.priceValueRow}>
              <span className={styles.filterFieldLabel}>Цена до</span>
              <span className={styles.priceValue}>{maxPrice >= MAX_PRICE_CEILING ? "Любая" : `${maxPrice} ₽`}</span>
            </div>
            <input
              className={styles.priceSlider}
              type="range"
              min={0}
              max={MAX_PRICE_CEILING}
              step={100}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              onMouseUp={() => applyFilters()}
              onTouchEnd={() => applyFilters()}
            />
          </div>

          <div className={styles.filterField}>
            <span className={styles.filterFieldLabel}>Рейтинг</span>
            <div className={styles.ratingPillRow}>
              {[undefined, 4.5, 4.8].map((r) => (
                <button
                  key={r ?? "any"}
                  type="button"
                  className={minRating === r ? styles.ratingPillActive : styles.ratingPill}
                  onClick={() => {
                    setMinRating(r);
                    applyFilters({ minRating: r });
                  }}
                >
                  {r ? `${r}+` : "Любой"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.onlineToggleRow}>
            <span className={styles.onlineToggleLabel}>Онлайн-занятия</span>
            <button
              type="button"
              className={onlineOnly ? `${styles.switch} ${styles.switchOn}` : styles.switch}
              onClick={() => {
                const next = !onlineOnly;
                setOnlineOnly(next);
                applyFilters({ onlineOnly: next });
              }}
            >
              <span className={styles.switchKnob} />
            </button>
          </div>

          <button type="button" className={styles.resetFiltersLink} onClick={resetFilters}>
            Сбросить фильтры
          </button>
        </div>

        <div className={styles.resultsColumn}>
          {state.status === "ready" && (
            <div className={styles.resultsHeader}>
              <span>Найдено {state.listings.length} объявлений</span>
              <div className={styles.layoutToggleRow}>
                <button
                  type="button"
                  className={listingsLayout === "column" ? styles.layoutToggleButtonActive : styles.layoutToggleButton}
                  title="В колонну"
                  aria-label="В колонну"
                  aria-pressed={listingsLayout === "column"}
                  onClick={() => setLayout("column")}
                >
                  <Icon name="list" size={16} />
                </button>
                <button
                  type="button"
                  className={listingsLayout === "grid3" ? styles.layoutToggleButtonActive : styles.layoutToggleButton}
                  title="3 в ряд"
                  aria-label="3 в ряд"
                  aria-pressed={listingsLayout === "grid3"}
                  onClick={() => setLayout("grid3")}
                >
                  <Icon name="grid-3" size={16} />
                </button>
              </div>
            </div>
          )}

          {state.status === "loading" && <StateScreen kind="loading" title="Загрузка тренеров…" />}
          {state.status === "error" && (
            <StateScreen kind="error" title="Не удалось загрузить тренеров" description={state.message} onRetry={() => load({})} />
          )}
          {state.status === "ready" && state.listings.length === 0 && (
            <StateScreen kind="empty" title="Пока никого нет" description="Объявления появятся здесь, когда тренеры их опубликуют." />
          )}
          {state.status === "ready" && state.listings.length > 0 && (() => {
            const selected = state.listings.find((l) => l.id === selectedId) ?? state.listings[0]!;
            const gridClassName = listingsLayout === "grid3" ? styles.listingsGrid3 : styles.listingsColumn;
            const cards = (
              <div className={gridClassName}>
                {state.listings.map((listing) => (
                  <ListingCardView
                    key={listing.id}
                    token={token}
                    listing={listing}
                    onOpen={() =>
                      showDetailPanel
                        ? setSelectedId(listing.id)
                        : setView({ screen: "coachProfile", coachUserId: listing.coachUserId })
                    }
                  />
                ))}
              </div>
            );

            // libraryLayout reserves a fixed 360px column for the detail
            // panel — only wrap in it when that panel actually renders, or
            // the reserved (empty) column starves the cards of width.
            if (!showDetailPanel) return cards;

            return (
              <div className={libStyles.libraryLayout}>
                <div className={libStyles.libraryMain}>{cards}</div>
                <ListingDetailPanel
                  token={token}
                  listing={selected}
                  onBook={() => setView({ screen: "profile", listingId: selected.id, coachUserId: selected.coachUserId })}
                  onOpenProfile={() => setView({ screen: "coachProfile", coachUserId: selected.coachUserId })}
                />
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
