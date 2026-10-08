// frontend/src/components/coaches/PlayerPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getPlayerPublicProfile, getPlayerReviews } from "../../api/players";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AchievementsGallery } from "../profile/AchievementsGallery";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { PlayerPublicProfile, PlayerReviews } from "../../types/player";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function PlayerReviewsCard({ token, playerUserId }: { token: string; playerUserId: string }) {
  const [reviews, setReviews] = useState<PlayerReviews | null>(null);

  useEffect(() => {
    // Only coaches with a booking with this player may read it; anyone else just doesn't see the block.
    getPlayerReviews(token, playerUserId)
      .then(setReviews)
      .catch(() => setReviews(null));
  }, [token, playerUserId]);

  if (reviews === null) return null;
  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Отзывы тренеров</h2>
      {reviews.count === 0 ? (
        <p className={profileStyles.subtitle}>О этом игроке пока нет отзывов.</p>
      ) : (
        <>
          <p className={profileStyles.subtitle}>
            Средняя оценка: <b>{reviews.average?.toFixed(1)}</b> из 5 · отзывов: {reviews.count}
          </p>
          {reviews.reviews.map((r) => (
            <div className={styles.reviewItem} key={r.id}>
              <div className={styles.reviewHead}>
                <span>{r.coachName}</span>
                <span className={styles.reviewStars} aria-label={`${r.rating} из 5`}>
                  {stars(r.rating)}
                </span>
              </div>
              {r.text && <p className={profileStyles.subtitle}>{r.text}</p>}
              <p className={profileStyles.subtitle}>{new Date(r.createdAt).toLocaleDateString("ru-RU")}</p>
            </div>
          ))}
        </>
      )}
      <p className={profileStyles.subtitle}>Отзывы оставляют тренеры после проведённых занятий; их видят только тренеры, у которых есть запись с этим игроком.</p>
    </div>
  );
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: PlayerPublicProfile };

/** A player's profile as viewed by a coach they have a booking
 * relationship with — reachable while triaging a pending request and
 * afterward from "Записи". Read-only, same shape as the athlete's own
 * profile plus their achievements gallery. */
export function PlayerPublicProfileScreen({
  token,
  playerUserId,
  onBack,
}: {
  token: string;
  playerUserId: string;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    getPlayerPublicProfile(token, playerUserId)
      .then((profile) => setState({ status: "ready", profile }))
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError && err.code === "not_found"
            ? "Игрок ещё не заполнил профиль."
            : err instanceof ApiError
              ? err.message
              : "Не удалось загрузить профиль игрока";
        setState({ status: "error", message });
      });
  }, [token, playerUserId]);

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
                    {[profile.position, profile.sport].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              {(profile.age !== null || profile.heightCm !== null || profile.weightKg !== null) && (
                <div className={sharedStyles.statGrid}>
                  {profile.age !== null && (
                    <div className={sharedStyles.statTile}>
                      <span className={sharedStyles.statValue}>{profile.age}</span>
                      <span className={sharedStyles.statLabel}>Возраст</span>
                    </div>
                  )}
                  {profile.heightCm !== null && (
                    <div className={sharedStyles.statTile}>
                      <span className={sharedStyles.statValue}>{profile.heightCm} см</span>
                      <span className={sharedStyles.statLabel}>Рост</span>
                    </div>
                  )}
                  {profile.weightKg !== null && (
                    <div className={sharedStyles.statTile}>
                      <span className={sharedStyles.statValue}>{profile.weightKg} кг</span>
                      <span className={sharedStyles.statLabel}>Вес</span>
                    </div>
                  )}
                </div>
              )}

              {profile.level && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Уровень</span>
                  <span className={profileStyles.rowValue}>{SKILL_LEVEL_LABELS[profile.level]}</span>
                </div>
              )}
              {profile.goals && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Цели</span>
                  <span className={profileStyles.rowValue}>{profile.goals}</span>
                </div>
              )}
              {profile.loadRestrictions && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Ограничения по нагрузке</span>
                  <span className={profileStyles.rowValue}>{profile.loadRestrictions}</span>
                </div>
              )}
            </div>

            <PlayerReviewsCard token={token} playerUserId={profile.userId} />

            <AchievementsGallery token={token} userId={profile.userId} editable={false} />
          </>
        );
      })()}
    </div>
  );
}
