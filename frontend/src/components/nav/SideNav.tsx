import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { BrandLogo } from "../shared/BrandLogo";
import { Icon } from "../shared/Icon";
import type { NavItem } from "./BottomNav";
import styles from "./SideNav.module.css";

export interface SideNavTeam {
  name: string;
  roleLabel: string;
  initial: string;
  /** The team's uploaded logo; the initial stays underneath while it loads or if it fails. */
  logo?: { token: string; fileId: string } | null;
}

export interface SideNavUser {
  name: string;
  sub: string;
  photoUrl: string | null;
  initial: string;
}

interface SideNavProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onChange: (key: T) => void;
  team?: SideNavTeam | null;
  onOpenTeam?: () => void;
  user: SideNavUser;
  onOpenProfile: () => void;
  /** Present only for administrators (the server says who they are): opens /admin. */
  onOpenAdmin?: () => void;
}

/** Desktop-width counterpart to BottomNav — same NavItem data, vertical
 * layout, persistent (AppShell keeps it mounted even while an overlay/detail
 * screen is open, unlike the mobile bottom bar). Also carries the brand
 * mark, an optional primary-team switcher card, and the signed-in user row
 * — see docs/superpowers/specs/2026-09-22-bento-redesign-design.md. */
export function SideNav<T extends string>({ items, active, onChange, team, onOpenTeam, user, onOpenProfile, onOpenAdmin }: SideNavProps<T>) {
  return (
    <nav className={styles.nav}>
      <div className={styles.brandRow}>
        <BrandLogo className={styles.brandMark} />
        <span className={styles.brandName}>SportArenaGlobal</span>
      </div>

      {team && (
        <button type="button" className={styles.teamCard} onClick={onOpenTeam} disabled={!onOpenTeam}>
          <div className={styles.teamCardAvatar}>
            {team.initial}
            {team.logo && (
              <AuthenticatedImage token={team.logo.token} fileId={team.logo.fileId} alt="" thumb className={styles.teamCardLogo} />
            )}
          </div>
          <div className={styles.teamCardText}>
            <span className={styles.teamCardName}>{team.name}</span>
            <span className={styles.teamCardRole}>{team.roleLabel}</span>
          </div>
          {onOpenTeam && (
            <span className={styles.teamCardChevron}>
              <Icon name="chevron-right" size={16} />
            </span>
          )}
        </button>
      )}

      <div className={styles.section}>
        <span className={styles.sectionLabel}>Меню</span>
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
              <span className={styles.itemLabel}>{item.label}</span>
              {!!item.badge && <span className={styles.itemBadge}>{item.badge}</span>}
            </button>
          );
        })}
        {onOpenAdmin && (
          <button type="button" className={styles.item} onClick={onOpenAdmin}>
            <Icon name="shield" size={20} strokeWidth={1.8} />
            <span className={styles.itemLabel}>Админ-панель</span>
          </button>
        )}
      </div>

      <button type="button" className={styles.userRow} onClick={onOpenProfile}>
        {user.photoUrl ? (
          <img className={styles.userAvatar} src={user.photoUrl} alt="" />
        ) : (
          <div className={styles.userAvatarPlaceholder}>{user.initial}</div>
        )}
        <div className={styles.userText}>
          <span className={styles.userName}>{user.name}</span>
          <span className={styles.userSub}>{user.sub}</span>
        </div>
        <span className={styles.userSettings}>
          <Icon name="settings" size={18} />
        </span>
      </button>
    </nav>
  );
}
