import type { ReactNode } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { currentPathWithSearch, loginUrl, registerUrl, useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import styles from "./public.module.css";

/** Header + footer around everything a visitor can open without an account:
 * the landing page, the coach catalogue and the legal documents. */
export function PublicShell({ children, next }: { children: ReactNode; next?: string | null }) {
  const { path } = useLocation();
  const { state } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const signedIn = state.status === "ready";
  const target = next ?? currentPathWithSearch();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand} aria-label="SportArena Global — на главную">
            <span className={styles.brandMark} aria-hidden="true">
              SA
            </span>
            <span className={styles.brandName}>SportArena Global</span>
          </Link>

          <nav className={styles.nav} aria-label="Основная навигация">
            <Link to="/coaches" className={`${styles.navLink} ${path === "/coaches" ? styles.navLinkActive : ""}`} aria-current={path === "/coaches" ? "page" : undefined}>
              Тренеры
            </Link>
          </nav>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.headerButton} ${styles.themeButton}`}
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
            </button>
            {signedIn ? (
              <Link to="/" className={`${styles.headerButton} ${styles.headerButtonPrimary}`}>
                В приложение
              </Link>
            ) : (
              <>
                <Link to={loginUrl(target)} className={styles.headerButton}>
                  Войти
                </Link>
                <Link to={registerUrl(target)} className={`${styles.headerButton} ${styles.headerButtonPrimary} ${styles.hideOnPhone}`}>
                  Регистрация
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={styles.content}>{children}</div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} SportArena Global</span>
          <Link to="/terms" className={styles.footerLink}>
            Пользовательское соглашение
          </Link>
          <Link to="/privacy" className={styles.footerLink}>
            Политика конфиденциальности
          </Link>
        </div>
      </footer>
    </div>
  );
}
