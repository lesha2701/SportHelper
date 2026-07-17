import styles from "./BottomNav.module.css";

export interface NavItem<T extends string> {
  key: T;
  label: string;
  icon: string;
}

interface BottomNavProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function BottomNav<T extends string>({ items, active, onChange }: BottomNavProps<T>) {
  return (
    <nav className={styles.nav}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.key === active ? styles.itemActive : styles.item}
          onClick={() => onChange(item.key)}
        >
          <span className={styles.icon}>{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
