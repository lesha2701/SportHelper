import { useEffect } from "react";
import { sendActivityPing } from "../api/activity";

/** How often an interacting, visible page reports that the person is still here. */
export const ACTIVITY_PING_INTERVAL_MS = 5 * 60 * 1000;

const INPUT_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;

/** Reports activity for the admin statistics (DAU/WAU/MAU) without a request per click:
 *   - once when the signed-in app opens in a visible tab (saved login counts, no password needed);
 *   - then at most every 5 minutes, and only if the person actually did something (tap, key, scroll)
 *     since the last report - an idle tab left open stops being "active";
 *   - and when they come back to a hidden tab after a while.
 * Background polling (notifications, session checks) never counts. Several tabs just report the same
 * person; the server records one row per person per day. Failures are silent - this is statistics. */
export function useActivityPing(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let touched = false;
    let lastSent = 0;

    const send = () => {
      lastSent = Date.now();
      touched = false;
      void sendActivityPing().catch(() => {});
    };
    const onInput = () => {
      touched = true;
    };
    const visible = () => document.visibilityState === "visible";

    if (visible()) send();

    const timer = window.setInterval(() => {
      if (visible() && touched && Date.now() - lastSent >= ACTIVITY_PING_INTERVAL_MS - 1000) send();
    }, 30_000);
    const onVisibility = () => {
      if (visible() && Date.now() - lastSent >= ACTIVITY_PING_INTERVAL_MS) send();
    };

    INPUT_EVENTS.forEach((name) => window.addEventListener(name, onInput, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, onInput, { capture: true }));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
