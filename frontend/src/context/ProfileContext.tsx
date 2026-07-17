import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { fetchProfileMe, saveCoachProfile, savePlayerProfile, switchActiveMode } from "../api/profile";
import type { ActiveMode, CoachProfileInput, PlayerProfileInput, ProfileMe } from "../types/profile";

export type ProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProfileMe };

interface ProfileContextValue {
  state: ProfileState;
  retry: () => void;
  savePlayer: (input: PlayerProfileInput) => Promise<void>;
  saveCoach: (input: CoachProfileInput) => Promise<void>;
  switchMode: (mode: ActiveMode) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ token, children }: { token: string; children: ReactNode }) {
  const [state, setState] = useState<ProfileState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchProfileMe(token)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить профиль";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const savePlayer = useCallback(
    async (input: PlayerProfileInput) => {
      await savePlayerProfile(token, input);
      load();
    },
    [token, load],
  );

  const saveCoach = useCallback(
    async (input: CoachProfileInput) => {
      await saveCoachProfile(token, input);
      load();
    },
    [token, load],
  );

  const switchMode = useCallback(
    async (mode: ActiveMode) => {
      const data = await switchActiveMode(token, mode);
      setState({ status: "ready", data });
    },
    [token],
  );

  return (
    <ProfileContext.Provider value={{ state, retry: load, savePlayer, saveCoach, switchMode }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return ctx;
}
