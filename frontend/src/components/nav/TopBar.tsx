import { Icon, type IconName } from "../shared/Icon";
import styles from "./TopBar.module.css";

export interface TopBarCta {
  label: string;
  icon: IconName;
  onClick: () => void;
}

export interface TopBarConfig {
  kicker: string;
  title: string;
  cta?: TopBarCta;
}

/** Desktop-only page header: section kicker + title, a (currently inert —
 * no search endpoint yet) search field, a decorative notification bell, and
 * the screen's primary action. Persistent chrome next to SideNav, not
 * per-screen content — see AppShell. */
export function TopBar({ kicker, title, cta }: TopBarConfig) {
  return (
    <div className={styles.bar}>
      <div className={styles.heading}>
        <span className={styles.kicker}>{kicker}</span>
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.search}>
        <Icon name="search" size={17} />
        <input
          className={styles.searchInput}
          placeholder="Поиск игроков, упражнений…"
          disabled
          title="Поиск появится позже"
        />
        <span className={styles.searchKey}>⌘K</span>
      </div>
      <button type="button" className={styles.bell} title="Уведомления" disabled>
        <Icon name="bell" size={19} />
      </button>
      {cta && (
        <button type="button" className={styles.cta} onClick={cta.onClick}>
          <Icon name={cta.icon} size={16} strokeWidth={2.4} />
          {cta.label}
        </button>
      )}
    </div>
  );
}
