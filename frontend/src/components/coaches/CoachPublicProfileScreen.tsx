// frontend/src/components/coaches/CoachPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getCoachPublicProfile } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachPublicProfile } from "../../types/coach";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function CoachPublicProfileScreen({
  token,
  coachUserId,
  onBack,
  onBook,
}: {
  token: string;
  coachUserId: string;
  onBack: () => void;
  onBook: () => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: CoachPublicProfile }>({
    status: "loading",
  });

  useEffect(() => {
    setState({ status: "loading" });
    getCoachPublicProfile(token, coachUserId)
      .then((profile) => setState({ status: "ready", profile }))
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
        const { profile } = state;
        const formats = [profile.offersOnline && "Онлайн", profile.offersOffline && "Очно"].filter(Boolean).join(" · ");

        return (
          <>
            <div className={profileStyles.card}>
              <div className={styles.profileHero}>
                {profile.photoUrl ? (
                  <img className={styles.profileAvatarLg} src={profile.photoUrl} alt="" />
                ) : (
                  <div className={styles.profileAvatarLg}>{profile.fullName.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <h1 className={profileStyles.title}>{profile.fullName}</h1>
                  <p className={profileStyles.subtitle}>
                    {profile.sport}
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
                  <span className={profileStyles.rowValue}>{profile.description}</span>
                </div>
              )}

              <div className={profileStyles.row}>
                <span className={profileStyles.rowLabel}>Цена</span>
                <span className={profileStyles.rowValue}>
                  {profile.pricePerSession !== null ? `${profile.pricePerSession} ${profile.currency}` : "Не указана"}
                  {profile.sessionDurationMinutes ? ` / ${profile.sessionDurationMinutes} мин` : ""}
                </span>
              </div>
              {formats && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Формат</span>
                  <span className={profileStyles.rowValue}>{formats}</span>
                </div>
              )}
              {profile.location && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Город</span>
                  <span className={profileStyles.rowValue}>{profile.location}</span>
                </div>
              )}

              <div className={profileStyles.formActions}>
                <button type="button" className={profileStyles.buttonPrimary} onClick={onBook}>
                  Записаться
                </button>
              </div>
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Расписание</h2>
              {profile.availability.length === 0 && <p className={profileStyles.subtitle}>Пока нет доступного времени.</p>}
              {profile.availability.map((w) => (
                <div className={styles.availabilityRow} key={w.id}>
                  <span>{WEEKDAY_LABELS[w.weekday]}</span>
                  <span>
                    {w.startTime.slice(0, 5)} — {w.endTime.slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Отзывы ({profile.reviewCount})</h2>
              {profile.recentReviews.length === 0 && <p className={profileStyles.subtitle}>Пока нет отзывов.</p>}
              {profile.recentReviews.map((review) => (
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
