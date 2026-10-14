import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, onSessionExpired, setCsrfToken } from "../api/client";
import { fetchMe, logout as logoutRequest, type AuthResult } from "../api/auth";
import type { User } from "../types/user";

export type AuthState =
  | { status: "loading" }
  /** Nobody is signed in (no session, or it ended). The public site is available. */
  | { status: "guest"; sessionExpired: boolean }
  /** The server could not be reached, so we can't tell either way. */
  | { status: "error"; message: string }
  /** Signed in. `token` is the session's CSRF token, held in memory only; it is
   * not a credential (the credential is an HttpOnly cookie the page cannot read).
   * It stays in the state because the existing screens pass it down as a prop. */
  | { status: "ready"; user: User; token: string };

interface AuthContextValue {
  state: AuthState;
  /** Checks the session again (e.g. after a network error). */
  retry: () => void;
  /** Merges a freshly-fetched User (e.g. after an avatar upload) into the
   * current session without a full re-login. No-op if not currently ready. */
  updateUser: (user: User) => void;
  /** Adopts the result of a successful login. */
  signIn: (result: AuthResult) => void;
  /** Ends the session on the server and returns to the public site. */
  logout: () => Promise<void>;
  /** Re-reads the user (e.g. after the email changed). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const readyRef = useRef(false);

  const adopt = useCallback((result: AuthResult) => {
    setCsrfToken(result.csrfToken);
    readyRef.current = true;
    setState({ status: "ready", user: result.user, token: result.csrfToken });
  }, []);

  const toGuest = useCallback((sessionExpired: boolean) => {
    setCsrfToken(null);
    readyRef.current = false;
    setState({ status: "guest", sessionExpired });
  }, []);

  const checkSession = useCallback(() => {
    setState({ status: "loading" });
    fetchMe()
      .then(adopt)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 0) {
          setState({ status: "error", message: error.message });
        } else {
          // 401 (no/ended session) or anything else we can't recover from: browse as a guest.
          toGuest(false);
        }
      });
  }, [adopt, toGuest]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Any request answered with 401 while signed in means the session ended
  // (expired, or revoked from another device): fall back to the public site.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (readyRef.current) toGuest(true);
      }),
    [toGuest],
  );

  const updateUser = useCallback((user: User) => {
    setState((prev) => (prev.status === "ready" ? { ...prev, user } : prev));
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Even if the server can't be reached we drop the local state; the
      // cookie is HttpOnly and expires or is revoked server-side.
    }
    toGuest(false);
  }, [toGuest]);

  const refreshUser = useCallback(async () => {
    try {
      adopt(await fetchMe());
    } catch {
      /* the next request will surface a lost session */
    }
  }, [adopt]);

  return (
    <AuthContext.Provider value={{ state, retry: checkSession, updateUser, signIn: adopt, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
