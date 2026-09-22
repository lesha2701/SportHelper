import type { ReactNode } from "react";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { BottomNav, type NavItem } from "./BottomNav";
import { SideNav, type SideNavTeam, type SideNavUser } from "./SideNav";
import { TopBar, type TopBarConfig } from "./TopBar";
import styles from "./AppShell.module.css";

interface AppShellProps<T extends string> {
  navItems: NavItem<T>[];
  activeTab: T;
  onChangeTab: (key: T) => void;
  /** Whether `children` is an overlay (team/training/etc. detail) rather
   * than the active tab's own screen. */
  hasOverlay: boolean;
  /** Desktop only: the sidebar's primary-team card and signed-in user row.
   * `team` is omitted while teams haven't loaded yet or there are none. */
  sideTeam?: SideNavTeam | null;
  onOpenTeam?: () => void;
  sideUser: SideNavUser;
  onOpenProfile: () => void;
  /** Desktop only: the page header (kicker/title/search/bell/CTA) shown
   * above `children`. Omitted for screens (mostly overlays) that still
   * render their own in-content header. */
  topBar?: TopBarConfig;
  children: ReactNode;
}

/** Mobile (<900px, see useIsDesktop): bottom tab bar; an open overlay
 * replaces the whole screen and hides the bar — unchanged push-navigation
 * behavior. Desktop (>=900px): a persistent sidebar (with team switcher and
 * user row) plus a persistent top bar replace the bar and stay mounted even
 * while an overlay is open, so switching sections never rebuilds the nav
 * chrome. See docs/superpowers/specs/2026-09-05-web-desktop-layout-design.md
 * and docs/superpowers/specs/2026-09-22-bento-redesign-design.md. */
export function AppShell<T extends string>({
  navItems,
  activeTab,
  onChangeTab,
  hasOverlay,
  sideTeam,
  onOpenTeam,
  sideUser,
  onOpenProfile,
  topBar,
  children,
}: AppShellProps<T>) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <div className={styles.desktopShell}>
        <SideNav
          items={navItems}
          active={activeTab}
          onChange={onChangeTab}
          team={sideTeam}
          onOpenTeam={onOpenTeam}
          user={sideUser}
          onOpenProfile={onOpenProfile}
        />
        <div className={styles.desktopMain}>
          {topBar && <TopBar {...topBar} />}
          <div className={styles.desktopContent}>
            <div className={styles.desktopContentInner}>{children}</div>
          </div>
        </div>
      </div>
    );
  }

  if (hasOverlay) {
    return <>{children}</>;
  }

  return (
    <div className={styles.mobileShell}>
      <div className={styles.mobileScroll}>{children}</div>
      <BottomNav items={navItems} active={activeTab} onChange={onChangeTab} />
    </div>
  );
}
