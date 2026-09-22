import { useEffect, useState } from "react";
import { listCoachPendingBookings } from "../../api/bookings";
import { useAuth } from "../../context/AuthContext";
import { Icon } from "../shared/Icon";
import { SKILL_LEVEL_LABELS, type ActiveMode, type ProfileMe } from "../../types/profile";
import styles from "./profile.module.css";

interface ProfileSummaryProps {
  token: string;
  profile: ProfileMe;
  onEdit: (mode: ActiveMode) => void;
  onSwitchMode: (mode: ActiveMode) => void;
  onCreateOther: (mode: ActiveMode) => void;
  onOpenMyStats: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenMarketplaceSettings: () => void;
  onOpenMyBookings: () => void;
  onOpenIncomingBookings: () => void;
}

function Avatar({ photoUrl, fallbackName }: { photoUrl: string | null; fallbackName: string }) {
  if (photoUrl) {
    return <img className={styles.avatar} src={photoUrl} alt="" />;
  }
  return <div className={styles.avatarPlaceholder}>{fallbackName.trim().charAt(0).toUpperCase() || "?"}</div>;
}

export function ProfileSummary({
  token,
  profile,
  onEdit,
  onSwitchMode,
  onCreateOther,
  onOpenMyStats,
  onOpenHelp,
  onOpenSettings,
  onOpenMarketplaceSettings,
  onOpenMyBookings,
  onOpenIncomingBookings,
}: ProfileSummaryProps) {
  const { state: authState } = useAuth();
  const photoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const mode: ActiveMode = profile.activeMode ?? (profile.player ? "player" : "coach");

  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (mode !== "coach") return;
    listCoachPendingBookings(token)
      .then((bookings) => setPendingCount(bookings.length))
      .catch(() => setPendingCount(0));
  }, [token, mode]);

  return (
    <div className={styles.summaryScreen}>
      <div className={styles.summaryIdentity}>
      {mode === "player" && profile.player && (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <Avatar photoUrl={photoUrl} fallbackName={profile.player.fullName} />
            <div>
              <h1 className={styles.title}>{profile.player.fullName}</h1>
              <p className={styles.subtitle}>Профиль игрока</p>
            </div>
            <button type="button" className={styles.settingsButton} onClick={onOpenSettings} aria-label="Настройки">
              <Icon name="settings" size={18} />
            </button>
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>Вид спорта</span>
            <span className={styles.rowValue}>{profile.player.sport}</span>
          </div>
          {profile.player.position && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Позиция</span>
              <span className={styles.rowValue}>{profile.player.position}</span>
            </div>
          )}
          {profile.player.level && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Уровень</span>
              <span className={styles.rowValue}>{SKILL_LEVEL_LABELS[profile.player.level]}</span>
            </div>
          )}
          {profile.player.age !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Возраст</span>
              <span className={styles.rowValue}>{profile.player.age}</span>
            </div>
          )}
          {profile.player.heightCm !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Рост</span>
              <span className={styles.rowValue}>{profile.player.heightCm} см</span>
            </div>
          )}
          {profile.player.weightKg !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Вес</span>
              <span className={styles.rowValue}>{profile.player.weightKg} кг</span>
            </div>
          )}
          {profile.player.goals && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Цели</span>
              <span className={styles.rowValue}>{profile.player.goals}</span>
            </div>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.buttonPrimary} onClick={() => onEdit("player")}>
              Редактировать
            </button>
          </div>
        </div>
      )}

      {mode === "coach" && profile.coach && (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <Avatar photoUrl={photoUrl} fallbackName={profile.coach.fullName} />
            <div>
              <h1 className={styles.title}>{profile.coach.fullName}</h1>
              <p className={styles.subtitle}>Профиль тренера</p>
            </div>
            <button type="button" className={styles.settingsButton} onClick={onOpenSettings} aria-label="Настройки">
              <Icon name="settings" size={18} />
            </button>
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>Вид спорта</span>
            <span className={styles.rowValue}>{profile.coach.sport}</span>
          </div>
          {profile.coach.experienceYears !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Опыт</span>
              <span className={styles.rowValue}>{profile.coach.experienceYears} лет</span>
            </div>
          )}
          {profile.coach.specialization && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Специализация</span>
              <span className={styles.rowValue}>{profile.coach.specialization}</span>
            </div>
          )}
          {profile.coach.description && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>О себе</span>
              <span className={styles.rowValue}>{profile.coach.description}</span>
            </div>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.buttonPrimary} onClick={() => onEdit("coach")}>
              Редактировать
            </button>
          </div>
        </div>
      )}
      </div>

      <div className={styles.summaryActions}>
        <div className={styles.actionGrid}>
          {mode === "coach" && profile.coach && (
            <button type="button" className={styles.actionTile} onClick={onOpenMarketplaceSettings}>
              <span className={styles.actionTileIcon}>
                <Icon name="settings" size={18} />
              </span>
              <span className={styles.actionTileLabel}>Мои объявления</span>
              <span className={styles.actionTileChevron}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          )}

          {mode === "coach" && profile.coach && (
            <button type="button" className={styles.actionTile} onClick={onOpenIncomingBookings}>
              <span className={styles.actionTileIcon}>
                <Icon name="inbox" size={18} />
              </span>
              <span className={styles.actionTileLabel}>Входящие заявки</span>
              {pendingCount > 0 && <span className={styles.actionTileBadge}>{pendingCount}</span>}
              <span className={styles.actionTileChevron}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          )}

          <button type="button" className={styles.actionTile} onClick={onOpenMyStats}>
            <span className={styles.actionTileIcon}>
              <Icon name="award" size={18} />
            </span>
            <span className={styles.actionTileLabel}>Моя статистика</span>
            <span className={styles.actionTileChevron}>
              <Icon name="chevron-right" size={18} />
            </span>
          </button>

          <button type="button" className={styles.actionTile} onClick={onOpenMyBookings}>
            <span className={styles.actionTileIcon}>
              <Icon name="calendar" size={18} />
            </span>
            <span className={styles.actionTileLabel}>Мои брони</span>
            <span className={styles.actionTileChevron}>
              <Icon name="chevron-right" size={18} />
            </span>
          </button>

          <button type="button" className={styles.actionTile} onClick={onOpenHelp}>
            <span className={styles.actionTileIcon}>
              <Icon name="book" size={18} />
            </span>
            <span className={styles.actionTileLabel}>Помощь</span>
            <span className={styles.actionTileChevron}>
              <Icon name="chevron-right" size={18} />
            </span>
          </button>

          {profile.player && profile.coach && (
            <button
              type="button"
              className={styles.actionTile}
              onClick={() => onSwitchMode(mode === "player" ? "coach" : "player")}
            >
              <span className={styles.actionTileIcon}>
                <Icon name="users" size={18} />
              </span>
              <span className={styles.actionTileLabel}>Переключиться на {mode === "player" ? "тренера" : "игрока"}</span>
              <span className={styles.actionTileChevron}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          )}
          {!profile.player && (
            <button type="button" className={styles.actionTile} onClick={() => onCreateOther("player")}>
              <span className={styles.actionTileIcon}>
                <Icon name="plus" size={18} />
              </span>
              <span className={styles.actionTileLabel}>Завести профиль игрока</span>
              <span className={styles.actionTileChevron}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          )}
          {!profile.coach && (
            <button type="button" className={styles.actionTile} onClick={() => onCreateOther("coach")}>
              <span className={styles.actionTileIcon}>
                <Icon name="plus" size={18} />
              </span>
              <span className={styles.actionTileLabel}>Завести профиль тренера</span>
              <span className={styles.actionTileChevron}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
