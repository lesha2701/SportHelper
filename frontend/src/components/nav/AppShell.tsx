import type { ReactNode } from "react";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { BottomNav, type NavItem } from "./BottomNav";
import { SideNav } from "./SideNav";
import styles from "./AppShell.module.css";

interface AppShellProps<T extends string> {
  navItems: NavItem<T>[];
  activeTab: T;
  onChangeTab: (key: T) => void;
  /** Whether `children` is an overlay (team/training/etc. detail) rather
   * than the active tab's own screen. */
  hasOverlay: boolean;
  children: ReactNode;
}

/** Mobile (<900px, see useIsDesktop): bottom tab bar; an open overlay
 * replaces the whole screen and hides the bar — unchanged push-navigation
 * behavior. Desktop (>=900px): a persistent sidebar replaces the bar and
 * stays mounted even while an overlay is open, so switching sections never
 * rebuilds the nav chrome. See
 * docs/superpowers/specs/2026-09-05-web-desktop-layout-design.md. */
export function AppShell<T extends string>({
  navItems,
  activeTab,
  onChangeTab,
  hasOverlay,
  children,
}: AppShellProps<T>) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <div className={styles.desktopShell}>
        <SideNav items={navItems} active={activeTab} onChange={onChangeTab} />
        <div className={styles.desktopContent}>
          <div className={styles.desktopContentInner}>{children}</div>
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
