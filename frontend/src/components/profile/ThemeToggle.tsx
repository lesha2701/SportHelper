import { useTheme } from "../../context/ThemeContext";
import { Icon } from "../shared/Icon";
import styles from "./profile.module.css";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={styles.card}>
      <span className={styles.label}>Оформление</span>
      <div className={styles.themeToggle}>
        <button
          type="button"
          className={theme === "dark" ? styles.themeOptionActive : styles.themeOption}
          onClick={() => theme !== "dark" && toggleTheme()}
        >
          <Icon name="moon" size={16} />
          Тёмная
        </button>
        <button
          type="button"
          className={theme === "light" ? styles.themeOptionActive : styles.themeOption}
          onClick={() => theme !== "light" && toggleTheme()}
        >
          <Icon name="sun" size={16} />
          Светлая
        </button>
      </div>
    </div>
  );
}
