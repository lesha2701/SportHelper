// frontend/src/components/coaches/CoachPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getCoachPublicProfile, listCoachPublicListings, listCoachPublicReviews } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AchievementsGallery } from "../profile/AchievementsGallery";
import type { CoachPublicProfile } from "../../types/coach";
import type { CoachListingCard, CoachReview } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      profile: CoachPublicProfile;
      listings: CoachListingCard[];
      reviews: CoachReview[];
    };

/** A coach's own public profile — reachable from the "Тренеры" marketplace
 * tab. Unlike ListingPublicProfileScreen (scoped to one bookable listing),
 * this shows the coach as a whole: avatar, experience, "о себе", their
 * achievements gallery, and blocks for all their listings and reviews. */
export function CoachPublicProfileScreen({
  token,
  coachUserId,
  onBack,
  onOpenListing,
}: {
  token: string;
  coachUserId: string;
  onBack: () => void;
  onOpenListing: (listingId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    Promise.all([
      getCoachPublicProfile(token, coachUserId),
      listCoachPublicListings(token, coachUserId),
      listCoachPublicReviews(token, coachUserId),
    ])
      .then(([profile, listings, reviews]) => setState({ status: "ready", profile, listings, reviews }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить профиль тренера";
        setState({ status: "error", message });
      });
  }, [token, coachUserId]);

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка профиля…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} />}

      {state.status === "ready" && (() => {
        const { profile, listings, reviews } = state;

        return (
          <>
            <div className={profileStyles.card}>
              <div className={styles.profileHero}>
                {profile.avatarFileId ? (
                  <AuthenticatedImage token={token} fileId={profile.avatarFileId} alt="" className={styles.profileAvatarLg} zoomable />
                ) : profile.photoUrl ? (
                  <img className={styles.profileAvatarLg} src={profile.photoUrl} alt="" />
                ) : (
                  <div className={styles.profileAvatarLg}>{profile.fullName.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <h1 className={profileStyles.title}>{profile.fullName}</h1>
                  <p className={profileStyles.subtitle}>
                    {[profile.specialization, profile.sport].filter(Boolean).join(" · ")}
                    {profile.experienceYears !== null ? ` · ${profile.experienceYears} лет опыта` : ""}
                  </p>
                  {profile.averageRating !== null && (
                    <p className={profileStyles.subtitle}>
                      <span className={styles.starRating}>★ {profile.averageRating.toFixed(1)}</span> ({profile.reviewCount} отзывов)
                    </p>
                  )}
                </div>
              </div>

              {profile.description && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>О себе</span>
                  <span className={profileStyles.rowValue}>{profile.description}</span>
                </div>
              )}
            </div>

            <AchievementsGallery token={token} userId={profile.userId} editable={false} />

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Объявления</h2>
              {listings.length === 0 && <p className={profileStyles.subtitle}>Пока нет опубликованных объявлений.</p>}
              {listings.map((listing) => (
                <button
                  key={listing.id}
                  type="button"
                  className={styles.bookingRow}
                  onClick={() => onOpenListing(listing.id)}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                >
                  <div>
                    <p className={profileStyles.rowValue}>{listing.title}</p>
                    <p className={profileStyles.subtitle}>
                      {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена не указана"}
                      {listing.location ? ` · ${listing.location}` : ""}
                    </p>
                  </div>
                  <Icon name="chevron-right" size={16} />
                </button>
              ))}
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Отзывы ({reviews.length})</h2>
              {reviews.length === 0 && <p className={profileStyles.subtitle}>Пока нет отзывов.</p>}
              {reviews.map((review) => (
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
