import { useProfile } from "../../context/ProfileContext";
import { StateScreen } from "../StateScreen";
import { CoachDashboard } from "./CoachDashboard";
import { PlayerDashboard } from "./PlayerDashboard";
import type { CalendarEvent } from "../../types/calendar";

interface DashboardScreenProps {
  token: string;
  userId: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
  onOpenMyStats: () => void;
}

/** Landing tab ("Главная") for both roles — routes to CoachDashboard or
 * PlayerDashboard based on the active profile mode. See
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Dashboard". */
export function DashboardScreen({
  token,
  userId,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
  onOpenMyStats,
}: DashboardScreenProps) {
  const { state } = useProfile();

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} />;
  }

  if (state.data.activeMode === "coach") {
    return <CoachDashboard token={token} onOpenEvent={onOpenEvent} onOpenTeam={onOpenTeam} />;
  }

  return (
    <PlayerDashboard
      token={token}
      userId={userId}
      onOpenEvent={onOpenEvent}
      onCreateTraining={onCreateTraining}
      onOpenMyStats={onOpenMyStats}
    />
  );
}
