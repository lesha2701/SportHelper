import { useEffect } from "react";
import { AppState } from "react-native";
import { sendActivityPing } from "@/api/activity";

const INTERVAL_MS = 5 * 60 * 1000;

/** Reports activity for the admin statistics like the website does: once when the signed-in app opens, then when it
 * comes back to the foreground after at least 5 minutes, and every 5 minutes while it stays open in front. Failures
 * are silent — this is statistics. The server keeps one row per person per day. */
export function useActivityPing(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let lastSent = 0;
    const send = () => {
      lastSent = Date.now();
      void sendActivityPing().catch(() => {});
    };
    if (AppState.currentState === "active") send();
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && Date.now() - lastSent >= INTERVAL_MS - 1000) send();
    }, 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastSent >= INTERVAL_MS) send();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled]);
}
