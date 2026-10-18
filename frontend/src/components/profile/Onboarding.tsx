import { Icon } from "../shared/Icon";
import styles from "./profile.module.css";

interface OnboardingProps {
  onChoosePlayer: () => void;
  onChooseCoach: () => void;
  /** The role chosen at registration. It cannot be changed, so (unless `canChooseBoth`) only that profile is offered. */
  preferredRole?: "player" | "coach" | null;
  /** Administrators may work in both roles. */
  canChooseBoth?: boolean;
}

export function Onboarding({ onChoosePlayer, onChooseCoach, preferredRole = null, canChooseBoth = false }: OnboardingProps) {
  const fixed = canChooseBoth ? null : preferredRole;
  const showPlayer = fixed !== "coach";
  const showCoach = fixed !== "player";
  const coachFirst = preferredRole === "coach";
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.pageHeading}>Добро пожаловать!</h1>
        <p className={styles.subtitle}>
          {fixed === "player" && "Заполните профиль игрока — это займёт минуту."}
          {fixed === "coach" && "Заполните профиль тренера — это займёт минуту."}
          {fixed === null && "Расскажите, кто вы в SportArenaGlobal."}
        </p>
        <div className={styles.onboardingChoices}>
          {showPlayer && (
            <button
              type="button"
              className={coachFirst && showCoach ? styles.buttonSecondary : styles.buttonPrimary}
              onClick={onChoosePlayer}
              style={coachFirst && showCoach ? { order: 2 } : undefined}
            >
              <Icon name="user" size={17} />
              {fixed === "player" ? "Создать профиль игрока" : "Я игрок"}
            </button>
          )}
          {showCoach && (
            <button
              type="button"
              className={coachFirst || !showPlayer ? styles.buttonPrimary : styles.buttonSecondary}
              onClick={onChooseCoach}
            >
              <Icon name="users" size={17} />
              {fixed === "coach" ? "Создать профиль тренера" : "Я тренер"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
