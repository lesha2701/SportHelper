// frontend/src/components/coaches/ListingPublicProfileScreen.tsx
import { ProBadge } from "../shared/ProBadge";
import { useEffect, useState } from "react";
import { getListingProfile, recordListingView, setListingFavorite } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { ReportButton } from "../shared/ReportButton";
import type { CoachListingProfile } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";
import { photoVideoGallery } from "../shared/MediaLightbox";
import { count, years } from "../../lib/plural";
import { formatSlotDate } from "./oneOffDates";
import { TitleWithBack } from "../shared/BackArrow";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function ListingPublicProfileScreen({
  token,
  listingId,
  onBack,
  onBook,
  ownUserId = null,
  canFavorite = false,
  onFavoriteChange,
}: {
  token: string;
  listingId: string;
  onBack: () => void;
  /** The signed-in person: on their own listing there is no «Записаться». */
  ownUserId?: string | null;
  canFavorite?: boolean;
  onFavoriteChange?: (listingId: string, isFavorite: boolean) => void;
  onBook: (listing: CoachListingProfile) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; listing: CoachListingProfile }
  >({ status: "loading" });
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  useEffect(() => {
    setState({ status: "loading" });
    getListingProfile(token, listingId)
      .then((listing) => {
        setState({ status: "ready", listing });
        if (listing.coachUserId !== ownUserId) {
          void recordListingView(token, listingId)
            .then((viewsCount) => setState((current) => current.status === "ready" && current.listing.id === listingId
              ? { status: "ready", listing: { ...current.listing, viewsCount } } : current))
            .catch(() => {});
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить объявление";
        setState({ status: "error", message });
      });
  }, [token, listingId, ownUserId]);

  const toggleFavorite = async (listing: CoachListingProfile) => {
    setFavoritePending(true);
    setFavoriteError(null);
    const next = !listing.isFavorite;
    try {
      await setListingFavorite(token, listing.id, next);
      setState((current) => current.status === "ready" ? { status: "ready", listing: { ...current.listing, isFavorite: next } } : current);
      onFavoriteChange?.(listing.id, next);
    } catch (err) {
      setFavoriteError(err instanceof ApiError ? err.message : "Не удалось изменить избранное");
    } finally {
      setFavoritePending(false);
    }
  };

  return (
    <div className={styles.listingScreen}>
      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка объявления…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить объявление" description={state.message} />}

      {state.status === "ready" && (() => {
        const { listing } = state;
        const formats = [listing.offersOnline && "Онлайн", listing.offersOffline && "Очно"].filter(Boolean).join(" · ");

        return (
          <div className={styles.listingLayout}>
            <div className={styles.listingMain}>
            <div className={profileStyles.card}>
              <div className={styles.profileHero}>
                {listing.coachPhotoUrl ? (
                  <img className={styles.profileAvatarLg} src={listing.coachPhotoUrl} alt="" />
                ) : (
                  <div className={styles.profileAvatarLg}>{listing.coachFullName.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <TitleWithBack onBack={onBack}>
                    <h1 className={profileStyles.title}>{listing.title}</h1>
                  </TitleWithBack>
                  <p className={profileStyles.subtitle}>
                    {listing.coachFullName}
                    {listing.coachIsPro && <ProBadge />}
                    {" "}· {listing.sport}
                    {listing.experienceYears !== null ? ` · ${years(listing.experienceYears)} опыта` : ""}
                  </p>
                  {listing.averageRating !== null && (
                    <p className={profileStyles.subtitle}>
                      <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({count(listing.reviewCount, "отзыв", "отзыва", "отзывов")})
                    </p>
                  )}
                </div>
              </div>

              {(() => {
                const g = photoVideoGallery(listing.photoFileId, listing.videoFileId, listing.title);
                return (
                  <>
                    {listing.photoFileId && (
                      <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={styles.listingPhoto} zoomable gallery={g.items} galleryIndex={g.photoIndex} />
                    )}
                    {listing.videoFileId && (
                      <AuthenticatedVideo token={token} fileId={listing.videoFileId} className={styles.listingVideo} zoomable gallery={g.items} galleryIndex={g.videoIndex} />
                    )}
                  </>
                );
              })()}

              {listing.description && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowValue}>{listing.description}</span>
                </div>
              )}
              {listing.coachDescription && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>О тренере</span>
                  <span className={profileStyles.rowValue}>{listing.coachDescription}</span>
                </div>
              )}

            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Расписание</h2>
              {listing.availability.length === 0 && listing.oneOffDates.length === 0 && (
                <p className={profileStyles.subtitle}>Пока нет доступного времени.</p>
              )}
              {listing.availability.map((w) => (
                <div className={styles.availabilityRow} key={w.id}>
                  <span>{WEEKDAY_LABELS[w.weekday]}</span>
                  <span>
                    {w.startTime.slice(0, 5)} — {w.endTime.slice(0, 5)}
                  </span>
                </div>
              ))}
              {listing.oneOffDates.length > 0 && (
                <>
                  <p className={profileStyles.subtitle}>Разовые даты</p>
                  {listing.oneOffDates.map((d) => (
                    <div className={styles.availabilityRow} key={d.id}>
                      <span>{formatSlotDate(d.slotDate)}</span>
                      <span>
                        {d.startTime.slice(0, 5)} — {d.endTime.slice(0, 5)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Отзывы ({listing.reviewCount})</h2>
              {listing.recentReviews.length === 0 && <p className={profileStyles.subtitle}>Пока нет отзывов.</p>}
              {listing.recentReviews.map((review) => (
                <div className={styles.reviewRow} key={review.id}>
                  <div className={styles.reviewHeader}>
                    <span>{review.athleteFirstName}</span>
                    <span className={styles.starRating}>★ {review.rating}</span>
                  </div>
                  {review.text && <p className={styles.reviewText}>{review.text}</p>}
                </div>
              ))}
            </div>
            </div>

            <aside className={`${profileStyles.card} ${styles.listingAside}`}>
              <div className={profileStyles.row}>
                <span className={profileStyles.rowLabel}>Цена</span>
                <span className={profileStyles.rowValue}>
                  {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Не указана"}
                  {listing.sessionDurationMinutes ? ` / ${listing.sessionDurationMinutes} мин` : ""}
                </span>
              </div>
              {formats && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Формат</span>
                  <span className={profileStyles.rowValue}>{formats}</span>
                </div>
              )}
              {listing.location && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Город</span>
                  <span className={profileStyles.rowValue}>{listing.location}</span>
                </div>
              )}

              <div className={profileStyles.formActions}>
                {canFavorite && listing.coachUserId !== ownUserId && (
                  <button type="button" className={profileStyles.buttonSecondary} aria-pressed={!!listing.isFavorite} disabled={favoritePending} onClick={() => void toggleFavorite(listing)}>
                    {listing.isFavorite ? "♥ В избранном" : "♡ В избранное"}
                  </button>
                )}
                {listing.coachUserId !== ownUserId && (
                  <button type="button" className={profileStyles.buttonPrimary} onClick={() => onBook(listing)}>
                    Записаться
                  </button>
                )}
                <ReportButton targetType="listing" targetId={listing.id} ownerUserId={listing.coachUserId} label="Пожаловаться на объявление" />
              </div>
              {favoriteError && <p role="alert" className={styles.favoriteError}>{favoriteError}</p>}
            </aside>
          </div>
        );
      })()}
    </div>
  );
}
