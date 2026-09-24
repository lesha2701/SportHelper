import { useState } from "react";
import { useProfile } from "../../context/ProfileContext";
import { StateScreen } from "../StateScreen";
import { MyListingsScreen } from "../coaches/MyListingsScreen";
import { IncomingBookingsScreen } from "../coaches/IncomingBookingsScreen";
import { MyBookingsSection } from "../coaches/MyBookingsSection";
import { CoachBookingsSection } from "../coaches/CoachBookingsSection";
import { CoachProfileForm } from "./CoachProfileForm";
import { HelpScreen } from "./HelpScreen";
import { Onboarding } from "./Onboarding";
import { PlayerProfileForm } from "./PlayerProfileForm";
import { ProfileSummary } from "./ProfileSummary";
import { SettingsScreen } from "./SettingsScreen";
import type { ActiveMode } from "../../types/profile";

export function ProfileScreen({
  token,
  onOpenMyStats,
  onOpenNotifications,
  unreadNotifications,
}: {
  token: string;
  onOpenMyStats: () => void;
  onOpenNotifications: () => void;
  unreadNotifications?: number;
}) {
  const { state, retry, savePlayer, saveCoach, switchMode } = useProfile();
  const [editing, setEditing] = useState<ActiveMode | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMarketplaceSettings, setShowMarketplaceSettings] = useState(false);
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [showCoachBookings, setShowCoachBookings] = useState(false);
  const [showIncomingBookings, setShowIncomingBookings] = useState(false);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка профиля…" />;
  }

  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} onRetry={retry} />;
  }

  if (showHelp) {
    return <HelpScreen onBack={() => setShowHelp(false)} />;
  }

  if (showSettings) {
    return <SettingsScreen token={token} onBack={() => setShowSettings(false)} />;
  }

  if (showMarketplaceSettings) {
    return <MyListingsScreen token={token} onBack={() => setShowMarketplaceSettings(false)} />;
  }

  if (showIncomingBookings) {
    return <IncomingBookingsScreen token={token} onBack={() => setShowIncomingBookings(false)} />;
  }

  if (showMyBookings) {
    return <MyBookingsSection token={token} onBack={() => setShowMyBookings(false)} />;
  }

  if (showCoachBookings) {
    return <CoachBookingsSection token={token} onBack={() => setShowCoachBookings(false)} />;
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
      onOpenHelp={() => setShowHelp(true)}
      onOpenSettings={() => setShowSettings(true)}
      onOpenMarketplaceSettings={() => setShowMarketplaceSettings(true)}
      onOpenMyBookings={() => setShowMyBookings(true)}
      onOpenCoachBookings={() => setShowCoachBookings(true)}
      onOpenIncomingBookings={() => setShowIncomingBookings(true)}
      onOpenNotifications={onOpenNotifications}
      unreadNotifications={unreadNotifications}
    />
  );
}
