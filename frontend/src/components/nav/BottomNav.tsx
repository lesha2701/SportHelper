import { Icon, type IconName } from "../shared/Icon";
import styles from "./BottomNav.module.css";

export interface NavItem<T extends string> {
  key: T;
  label: string;
  icon: IconName;
}

interface BottomNavProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function BottomNav<T extends string>({ items, active, onChange }: BottomNavProps<T>) {
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
            <Icon name={item.icon} size={22} strokeWidth={isActive ? 2.1 : 1.8} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
