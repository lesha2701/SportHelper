import { Icon } from "../shared/Icon";
import styles from "./profile.module.css";

interface OnboardingProps {
  onChoosePlayer: () => void;
  onChooseCoach: () => void;
  /** The role picked at sign-up: that button leads, the other stays available. */
  preferredRole?: "player" | "coach" | null;
}

export function Onboarding({ onChoosePlayer, onChooseCoach, preferredRole = null }: OnboardingProps) {
  const coachFirst = preferredRole === "coach";
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.pageHeading}>Добро пожаловать!</h1>
        <p className={styles.subtitle}>
          Расскажите, кто вы в SportArena Global. Позже можно завести оба профиля и переключаться между
          ними.
        </p>
        <div className={styles.onboardingChoices}>
          <button
            type="button"
            className={coachFirst ? styles.buttonSecondary : styles.buttonPrimary}
            onClick={onChoosePlayer}
            style={coachFirst ? { order: 2 } : undefined}
          >
            <Icon name="user" size={17} />
            Я игрок
          </button>
          <button type="button" className={coachFirst ? styles.buttonPrimary : styles.buttonSecondary} onClick={onChooseCoach}>
            <Icon name="users" size={17} />
            Я тренер
          </button>
        </div>
      </div>
    </div>
  );
}
