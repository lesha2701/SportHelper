// frontend/src/components/coaches/PlayerPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getPlayerPublicProfile } from "../../api/players";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AchievementsGallery } from "../profile/AchievementsGallery";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { PlayerPublicProfile } from "../../types/player";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

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

            <AchievementsGallery token={token} userId={profile.userId} editable={false} />
          </>
        );
      })()}
    </div>
  );
}
