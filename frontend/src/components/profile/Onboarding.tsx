import { Icon } from "../shared/Icon";
import styles from "./profile.module.css";

interface OnboardingProps {
  onChoosePlayer: () => void;
  onChooseCoach: () => void;
}

export function Onboarding({ onChoosePlayer, onChooseCoach }: OnboardingProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.pageHeading}>Добро пожаловать!</h1>
        <p className={styles.subtitle}>
          Расскажите, кто вы в TeamFlow Sports. Позже можно завести оба профиля и переключаться между
          ними.
        </p>
        <div className={styles.onboardingChoices}>
          <button type="button" className={styles.buttonPrimary} onClick={onChoosePlayer}>
            <Icon name="user" size={17} />
            Я игрок
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={onChooseCoach}>
            <Icon name="users" size={17} />
            Я тренер
          </button>
        </div>
      </div>
    </div>
  );
}
