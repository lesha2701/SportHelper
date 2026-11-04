import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as authApi from "@/api/auth";
import { ApiError, onSessionExpired } from "@/api/client";
import { clearToken, getToken, setToken } from "@/api/tokenStore";
import type { User } from "@/shared/types/user";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Starts the session handed out by the server (e.g. after the address was confirmed). */
  applySession: (result: authApi.LoginResult) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);

  // On start: a stored token is checked against the server; a dead or missing one means signed out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await getToken())) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      try {
        const me = await authApi.fetchMe();
        if (!cancelled) {
          setUser(me);
          setStatus("signedIn");
        }
      } catch (error) {
        // Only a rejected token is deleted.
        if (error instanceof ApiError && error.status === 401) await clearToken();
        // (A network failure leaves the stored token alone; the sign-in screen offers a fresh login meanwhile.)
        if (!cancelled) setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const endSession = useCallback(async () => {
    await clearToken();
    setUser(null);
    setStatus("signedOut");
  }, []);

  // A 401 on any signed-in request (session expired or revoked elsewhere) returns to the sign-in screen.
  useEffect(() => onSessionExpired(() => void endSession()), [endSession]);

  const applySession = useCallback(async (result: authApi.LoginResult) => {
    await setToken(result.accessToken);
    setUser(result.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => applySession(await authApi.login(email.trim(), password)),
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout(); // revokes the session on the server
    } catch {
      /* offline or already ended: the local token goes either way */
    }
    await endSession();
  }, [endSession]);

  const value = useMemo(() => ({ status, user, signIn, applySession, signOut }), [status, user, signIn, applySession, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
