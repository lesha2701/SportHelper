import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { devLogin, devLogin2, fetchCurrentUser, loginWithTelegram, type AuthResult } from "../api/auth";
import { bootstrapTelegram } from "../telegram/init";
import type { User } from "../types/user";

export type AuthState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "ready"; user: User; token: string };

interface AuthContextValue {
  state: AuthState;
  retry: () => void;
  /** Merges a freshly-fetched User (e.g. after an avatar upload) into the
   * current session without a full re-login. No-op if not currently ready. */
  updateUser: (user: User) => void;
  /** Completes a browser (non-Telegram) login and remembers the session. */
  signIn: (result: AuthResult) => void;
  logout: () => void;
}

const SESSION_KEY = "teamflow.session";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(SESSION_KEY, token);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode) — the session just won't survive a reload
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const runAuth = useCallback(() => {
    setState({ status: "loading" });

    const env = bootstrapTelegram();

    if (env.isAvailable && env.initDataRaw) {
      loginWithTelegram(env.initDataRaw)
        .then((result) => {
          setState({ status: "ready", user: result.user, token: result.accessToken });
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.code === "forbidden") {
            setState({ status: "forbidden", message: error.message });
            return;
          }
          const message = error instanceof ApiError ? error.message : "Не удалось выполнить вход";
          setState({ status: "error", message });
        });
      return;
    }

    // Not running inside a real Telegram client (e.g. opened directly in a
    // browser). In a dev build, fall back to the backend's dev-only login
    // instead of blocking with "open via Telegram" — stripped out of
    // production builds by import.meta.env.DEV, and the endpoint itself
    // only exists when the backend has DEV_AUTH_ENABLED set (docs/dev-notes.md).
    if (import.meta.env.DEV) {
      // ?devUser=2 opts into the second fixed dev identity — lets you open
      // a second tab and exercise a two-sided flow (e.g. an athlete
      // booking a coach) as two distinct logged-in users locally.
      const useSecondDevUser = new URLSearchParams(window.location.search).get("devUser") === "2";
      (useSecondDevUser ? devLogin2() : devLogin())
        .then((result) => {
          setState({ status: "ready", user: result.user, token: result.accessToken });
        })
        .catch(() => {
          setState({
            status: "error",
            message: "Dev-логин недоступен: задайте DEV_AUTH_ENABLED=true в backend .env и перезапустите backend",
          });
        });
      return;
    }

    // Plain browser: resume a remembered session, otherwise show the
    // "log in via the Telegram bot" screen (see BrowserLogin).
    const storedToken = readStoredToken();
    if (!storedToken) {
      setState({ status: "unavailable" });
      return;
    }
    fetchCurrentUser(storedToken)
      .then((user) => setState({ status: "ready", user, token: storedToken }))
      .catch(() => {
        writeStoredToken(null);
        setState({ status: "unavailable" });
      });
  }, []);

  useEffect(() => {
    runAuth();
  }, [runAuth]);

  const updateUser = useCallback((user: User) => {
    setState((prev) => (prev.status === "ready" ? { ...prev, user } : prev));
  }, []);

  const signIn = useCallback((result: AuthResult) => {
    writeStoredToken(result.accessToken);
    setState({ status: "ready", user: result.user, token: result.accessToken });
  }, []);

  const logout = useCallback(() => {
    writeStoredToken(null);
    setState({ status: "unavailable" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, retry: runAuth, updateUser, signIn, logout }}>
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
