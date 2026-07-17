import { useState } from "react";
import { useProfile } from "../../context/ProfileContext";
import { StateScreen } from "../StateScreen";
import { CoachProfileForm } from "./CoachProfileForm";
import { Onboarding } from "./Onboarding";
import { PlayerProfileForm } from "./PlayerProfileForm";
import { ProfileSummary } from "./ProfileSummary";
import type { ActiveMode } from "../../types/profile";

export function ProfileScreen({ token, onOpenMyStats }: { token: string; onOpenMyStats: () => void }) {
  const { state, retry, savePlayer, saveCoach, switchMode } = useProfile();
  const [editing, setEditing] = useState<ActiveMode | null>(null);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка профиля…" />;
  }

  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} onRetry={retry} />;
  }

  const { data } = state;
  const hasAnyProfile = data.player !== null || data.coach !== null;

  if (!hasAnyProfile && editing === null) {
    return <Onboarding onChoosePlayer={() => setEditing("player")} onChooseCoach={() => setEditing("coach")} />;
  }

  if (editing === "player") {
    return (
      <PlayerProfileForm
        initial={data.player}
        onSubmit={async (input) => {
          await savePlayer(input);
          setEditing(null);
        }}
        onCancel={hasAnyProfile ? () => setEditing(null) : undefined}
      />
    );
  }

  if (editing === "coach") {
    return (
      <CoachProfileForm
        initial={data.coach}
        onSubmit={async (input) => {
          await saveCoach(input);
          setEditing(null);
        }}
        onCancel={hasAnyProfile ? () => setEditing(null) : undefined}
      />
    );
  }

  return (
    <ProfileSummary
      token={token}
      profile={data}
      onEdit={(mode) => setEditing(mode)}
      onSwitchMode={(mode) => {
        void switchMode(mode);
      }}
      onCreateOther={(mode) => setEditing(mode)}
      onOpenMyStats={onOpenMyStats}
    />
  );
}
