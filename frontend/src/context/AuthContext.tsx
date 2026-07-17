import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { loginWithTelegram } from "../api/auth";
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const runAuth = useCallback(() => {
    setState({ status: "loading" });

    const env = bootstrapTelegram();
    if (!env.isAvailable || !env.initDataRaw) {
      setState({ status: "unavailable" });
      return;
    }

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
  }, []);

  useEffect(() => {
    runAuth();
  }, [runAuth]);

  return <AuthContext.Provider value={{ state, retry: runAuth }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
