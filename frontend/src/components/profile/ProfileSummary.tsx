import { useAuth } from "../../context/AuthContext";
import { NotificationSettings } from "./NotificationSettings";
import { ThemeToggle } from "./ThemeToggle";
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
}

function Avatar({ photoUrl, fallbackName }: { photoUrl: string | null; fallbackName: string }) {
  if (photoUrl) {
    return <img className={styles.avatar} src={photoUrl} alt="" />;
  }
  return <div className={styles.avatarPlaceholder}>{fallbackName.trim().charAt(0).toUpperCase() || "?"}</div>;
}

export function ProfileSummary({ token, profile, onEdit, onSwitchMode, onCreateOther, onOpenMyStats, onOpenHelp }: ProfileSummaryProps) {
  const { state: authState } = useAuth();
  const photoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const mode: ActiveMode = profile.activeMode ?? (profile.player ? "player" : "coach");

  return (
    <div className={styles.screen}>
      {mode === "player" && profile.player && (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <Avatar photoUrl={photoUrl} fallbackName={profile.player.fullName} />
            <div>
              <h1 className={styles.title}>{profile.player.fullName}</h1>
              <p className={styles.subtitle}>Профиль игрока</p>
            </div>
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

      <div className={styles.card}>
        <button type="button" className={styles.buttonPrimary} onClick={onOpenMyStats}>
          <Icon name="award" size={17} />
          Моя статистика
        </button>
      </div>

      <ThemeToggle />

      <NotificationSettings token={token} />

      <div className={styles.card}>
        <button type="button" className={styles.buttonSecondary} onClick={onOpenHelp}>
          <Icon name="book" size={17} />
          Помощь
        </button>
      </div>

      <div className={styles.card}>
        {profile.player && profile.coach && (
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => onSwitchMode(mode === "player" ? "coach" : "player")}
          >
            Переключиться на {mode === "player" ? "тренера" : "игрока"}
          </button>
        )}
        {!profile.player && (
          <button type="button" className={styles.buttonSecondary} onClick={() => onCreateOther("player")}>
            Завести профиль игрока
          </button>
        )}
        {!profile.coach && (
          <button type="button" className={styles.buttonSecondary} onClick={() => onCreateOther("coach")}>
            Завести профиль тренера
          </button>
        )}
      </div>
    </div>
  );
}
