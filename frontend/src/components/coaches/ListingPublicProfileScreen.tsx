// frontend/src/components/coaches/ListingPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getListingProfile } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import type { CoachListingProfile } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function ListingPublicProfileScreen({
  token,
  listingId,
  onBack,
  onBook,
}: {
  token: string;
  listingId: string;
  onBack: () => void;
  onBook: (listing: CoachListingProfile) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; listing: CoachListingProfile }
  >({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    getListingProfile(token, listingId)
      .then((listing) => setState({ status: "ready", listing }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить объявление";
        setState({ status: "error", message });
      });
  }, [token, listingId]);

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка объявления…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить объявление" description={state.message} />}

      {state.status === "ready" && (() => {
        const { listing } = state;
        const formats = [listing.offersOnline && "Онлайн", listing.offersOffline && "Очно"].filter(Boolean).join(" · ");

        return (
          <>
            <div className={profileStyles.card}>
              <div className={styles.profileHero}>
                {listing.coachPhotoUrl ? (
                  <img className={styles.profileAvatarLg} src={listing.coachPhotoUrl} alt="" />
                ) : (
                  <div className={styles.profileAvatarLg}>{listing.coachFullName.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <h1 className={profileStyles.title}>{listing.title}</h1>
                  <p className={profileStyles.subtitle}>
                    {listing.coachFullName} · {listing.sport}
                    {listing.experienceYears !== null ? ` · ${listing.experienceYears} лет опыта` : ""}
                  </p>
                  {listing.averageRating !== null && (
                    <p className={profileStyles.subtitle}>
                      <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({listing.reviewCount} отзывов)
                    </p>
                  )}
                </div>
              </div>

              {listing.photoFileId && (
                <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={styles.listingPhoto} />
              )}
              {listing.videoFileId && <AuthenticatedVideo token={token} fileId={listing.videoFileId} className={styles.listingVideo} />}

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
                <button type="button" className={profileStyles.buttonPrimary} onClick={() => onBook(listing)}>
                  Записаться
                </button>
              </div>
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Расписание</h2>
              {listing.availability.length === 0 && <p className={profileStyles.subtitle}>Пока нет доступного времени.</p>}
              {listing.availability.map((w) => (
                <div className={styles.availabilityRow} key={w.id}>
                  <span>{WEEKDAY_LABELS[w.weekday]}</span>
                  <span>
                    {w.startTime.slice(0, 5)} — {w.endTime.slice(0, 5)}
                  </span>
                </div>
              ))}
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
          </>
        );
      })()}
    </div>
  );
}
