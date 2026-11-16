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
  /** The uploaded avatar (the same one the profile shows); the initial stays underneath while it loads or if it fails. */
  avatar?: { token: string; fileId: string } | null;
}

interface SideNavProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onChange: (key: T) => void;
  team?: SideNavTeam | null;
  onOpenTeam?: () => void;
  user: SideNavUser;
  onOpenProfile: () => void;
  /** The gear next to the user row: opens the profile settings directly. */
  onOpenSettings?: () => void;
  /** Kept for callers; the admin panel is opened from the profile list, not from the header. */
  onOpenAdmin?: () => void;
}

/** Desktop-width counterpart to BottomNav — same NavItem data, shown as a "pill" of sections in the persistent header.
 * AppShell keeps it mounted even while an overlay/detail screen is open, unlike the mobile bottom bar. Also carries the
 * brand mark, an optional primary-team switcher chip and the signed-in user (avatar + settings). The root vanishes
 * (display: contents) so the header can lay everything out in one row together with the TopBar buttons. */
export function SideNav<T extends string>({ items, active, onChange, team, onOpenTeam, user, onOpenProfile, onOpenSettings }: SideNavProps<T>) {
  return (
    <div className={styles.root}>
      {/* the logo leads home: the first section of the pill */}
      <button type="button" className={styles.brandRow} onClick={() => onChange(items[0]!.key)} aria-label="SportArenaGlobal — на главную">
        <BrandLogo className={styles.brandMark} />
        <span className={styles.brandName}>SportArenaGlobal</span>
      </button>

      <nav className={styles.pills} aria-label="Разделы">
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
              <span className={styles.itemLabel}>{item.label}</span>
              {!!item.badge && <span className={styles.itemBadge}>{item.badge}</span>}
            </button>
          );
        })}
      </nav>

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
        </button>
      )}

      <div className={styles.userRow}>
        <button type="button" className={styles.userMain} onClick={onOpenProfile}>
          {user.avatar ? (
            <div className={styles.userAvatarPlaceholder}>
              {user.initial}
              <AuthenticatedImage token={user.avatar.token} fileId={user.avatar.fileId} alt="" thumb className={styles.userAvatarImage} />
            </div>
          ) : user.photoUrl ? (
            <img className={styles.userAvatar} src={user.photoUrl} alt="" />
          ) : (
            <div className={styles.userAvatarPlaceholder}>{user.initial}</div>
          )}
          <div className={styles.userText}>
            <span className={styles.userName}>{user.name}</span>
            <span className={styles.userSub}>{user.sub}</span>
          </div>
        </button>
        <button type="button" className={styles.userSettings} onClick={onOpenSettings} aria-label="Настройки" title="Настройки">
          <Icon name="settings" size={18} />
        </button>
      </div>
    </div>
  );
}
