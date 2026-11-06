import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { listNotifications } from "@/api/notifications";
import { useAuth } from "@/auth/AuthProvider";

interface Unread {
  count: number;
  refresh: () => void;
}

const UnreadContext = createContext<Unread>({ count: 0, refresh: () => {} });

const EVERY_MS = 60_000;

/** How many notifications are unread, for the bell in the header: asked after sign-in, every minute while the app is
 * open, when it comes back to the foreground, and whenever a screen says something was read. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    listNotifications()
      .then((items) => setCount(items.filter((n) => !n.readAt).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status !== "signedIn") {
      setCount(0);
      return;
    }
    refresh();
    const timer = setInterval(refresh, EVERY_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): Unread {
  return useContext(UnreadContext);
}
