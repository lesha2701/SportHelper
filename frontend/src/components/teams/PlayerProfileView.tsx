import { useEffect, useState } from "react";
import { getMemberPlayerProfile } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { PlayerStatsScreen } from "../stats/PlayerStatsScreen";
import { Icon } from "../shared/Icon";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { PlayerProfile } from "../../types/profile";
import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready"; profile: PlayerProfile };

export function PlayerProfileView({
  token,
  teamId,
  userId,
  displayName,
  onBack,
}: {
  token: string;
  teamId: string;
  userId: string;
  displayName: string;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    setState({ status: "loading" });
    getMemberPlayerProfile(token, teamId, userId)
      .then((profile) => setState({ status: "ready", profile }))
      .catch((error: unknown) => {
        const notFound = error instanceof ApiError && error.code === "not_found";
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить профиль";
        setState({ status: "error", message, notFound });
      });
  }, [token, teamId, userId]);

  if (showStats) {
    return <PlayerStatsScreen token={token} userId={userId} onBack={() => setShowStats(false)} />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
        <button type="button" className={styles.iconButton} onClick={() => setShowStats(true)}>
          Статистика
        </button>
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка профиля…" />}

      {state.status === "error" && state.notFound && (
        <StateScreen kind="empty" title="Профиль игрока не заполнен" description={`${displayName} ещё не заполнил(а) профиль игрока.`} />
      )}

      {state.status === "error" && !state.notFound && (
        <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} />
      )}

      {state.status === "ready" && (
        <div className={profileStyles.card}>
          <div className={styles.teamCardRow}>
            <div className={styles.teamAvatar}>{displayName.trim().charAt(0).toUpperCase() || "?"}</div>
            <div className={styles.teamNameCol}>
              <h1 className={profileStyles.title}>{state.profile.fullName}</h1>
              <p className={profileStyles.subtitle} style={{ margin: 0 }}>
                Профиль игрока
              </p>
            </div>
          </div>

          {(state.profile.age !== null || state.profile.heightCm !== null || state.profile.weightKg !== null) && (
            <div className={styles.statGrid}>
              {state.profile.age !== null && (
                <div className={styles.statTile}>
                  <span className={styles.statValue}>{state.profile.age}</span>
                  <span className={styles.statLabel}>Возраст</span>
                </div>
              )}
              {state.profile.heightCm !== null && (
                <div className={styles.statTile}>
                  <span className={styles.statValue}>{state.profile.heightCm} см</span>
                  <span className={styles.statLabel}>Рост</span>
                </div>
              )}
              {state.profile.weightKg !== null && (
                <div className={styles.statTile}>
                  <span className={styles.statValue}>{state.profile.weightKg} кг</span>
                  <span className={styles.statLabel}>Вес</span>
                </div>
              )}
            </div>
          )}

          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Вид спорта</span>
            <span className={profileStyles.rowValue}>{state.profile.sport}</span>
          </div>
          {state.profile.position && (
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Позиция</span>
              <span className={profileStyles.rowValue}>{state.profile.position}</span>
            </div>
          )}
          {state.profile.level && (
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Уровень</span>
              <span className={profileStyles.rowValue}>{SKILL_LEVEL_LABELS[state.profile.level]}</span>
            </div>
          )}
          {state.profile.goals && (
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Цели</span>
              <span className={profileStyles.rowValue}>{state.profile.goals}</span>
            </div>
          )}
          {state.profile.loadRestrictions && (
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Ограничения по нагрузке</span>
              <span className={profileStyles.rowValue}>{state.profile.loadRestrictions}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
