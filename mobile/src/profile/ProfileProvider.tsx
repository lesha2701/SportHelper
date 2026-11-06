import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as profileApi from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import type { CoachProfileInput, PlayerProfileInput, ProfileMe } from "@/shared/types/profile";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ProfileMe };

interface ProfileState {
  state: State;
  reload: () => void;
  savePlayer: (input: PlayerProfileInput) => Promise<void>;
  saveCoach: (input: CoachProfileInput) => Promise<void>;
  switchMode: (mode: "player" | "coach") => Promise<void>;
}

const ProfileContext = createContext<ProfileState | null>(null);

/** The signed-in person's profile (player and/or coach), loaded once after sign-in. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<State>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await profileApi.fetchProfileMe() });
    } catch (error) {
      setState({ status: "error", message: toFormError(error).message });
    }
  }, []);

  useEffect(() => {
    if (status === "signedIn") void load();
    else setState({ status: "idle" });
  }, [status, user?.id, load]);

  const savePlayer = useCallback(
    async (input: PlayerProfileInput) => {
      await profileApi.savePlayerProfile(input);
      await load();
    },
    [load],
  );
  const saveCoach = useCallback(
    async (input: CoachProfileInput) => {
      await profileApi.saveCoachProfile(input);
      await load();
    },
    [load],
  );

  const switchMode = useCallback(async (mode: "player" | "coach") => {
    setState({ status: "ready", data: await profileApi.switchActiveMode(mode) });
  }, []);

  const value = useMemo(() => ({ state, reload: () => void load(), savePlayer, saveCoach, switchMode }), [state, load, savePlayer, saveCoach, switchMode]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
