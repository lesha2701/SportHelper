import { useEffect, useState } from "react";

// Kept in sync with the breakpoint AppShell/SideNav/BottomNav switch on —
// see docs/superpowers/specs/2026-09-05-web-desktop-layout-design.md.
const DESKTOP_QUERY = "(min-width: 900px)";

/** True when the viewport is wide enough for the persistent sidebar layout
 * (AppShell) instead of the mobile bottom-tab-bar layout. Reactive to window
 * resizes, not just the value at mount. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
