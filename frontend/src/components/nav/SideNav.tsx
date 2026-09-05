import { Icon } from "../shared/Icon";
import type { NavItem } from "./BottomNav";
import styles from "./SideNav.module.css";

interface SideNavProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onChange: (key: T) => void;
}

/** Desktop-width counterpart to BottomNav — same NavItem data, vertical
 * layout, persistent (AppShell keeps it mounted even while an overlay/detail
 * screen is open, unlike the mobile bottom bar). */
export function SideNav<T extends string>({ items, active, onChange }: SideNavProps<T>) {
  return (
    <nav className={styles.nav}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            className={isActive ? styles.itemActive : styles.item}
            onClick={() => onChange(item.key)}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={item.icon} size={20} strokeWidth={isActive ? 2.1 : 1.8} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
