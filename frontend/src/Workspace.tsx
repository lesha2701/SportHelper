import { useState } from "react";
import { ProfileProvider, useProfile } from "./context/ProfileContext";
import { useAuth } from "./context/AuthContext";
import { ProfileScreen } from "./components/profile/ProfileScreen";
import { TeamsScreen } from "./components/teams/TeamsScreen";
import { TeamDetailScreen } from "./components/teams/TeamDetailScreen";
import { MyTeamsScreen } from "./components/teams/MyTeamsScreen";
import { InviteAcceptScreen } from "./components/teams/InviteAcceptScreen";
import { LibraryScreen } from "./components/library/LibraryScreen";
import { TrainingForm } from "./components/trainings/TrainingForm";
import { TrainingDetail } from "./components/trainings/TrainingDetail";
import { TaskDetail } from "./components/tasks/TaskDetail";
import { MatchDetail } from "./components/matches/MatchDetail";
import { CalendarScreen } from "./components/CalendarScreen";
import { PlayerStatsScreen } from "./components/stats/PlayerStatsScreen";
import { StateScreen } from "./components/StateScreen";
import { BottomNav, type NavItem } from "./components/nav/BottomNav";
import type { Training } from "./types/training";
import type { CalendarEvent } from "./types/calendar";

function readInviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("invite");
}

type CoachTab = "teams" | "library" | "calendar" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why.
type PlayerTab = "teams" | "calendar" | "profile";

const COACH_NAV_ITEMS: NavItem<CoachTab>[] = [
  { key: "teams", label: "Команды", icon: "🏆" },
  { key: "library", label: "Библиотека", icon: "📚" },
  { key: "calendar", label: "Календарь", icon: "📅" },
  { key: "profile", label: "Профиль", icon: "👤" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab>[] = [
  { key: "teams", label: "Команды", icon: "🏆" },
  { key: "calendar", label: "Календарь", icon: "📅" },
  { key: "profile", label: "Профиль", icon: "👤" },
];

type Overlay =
  | { kind: "team"; teamId: string }
  | { kind: "training-create" }
  | { kind: "training-edit"; training: Training }
  | { kind: "training-detail"; trainingId: string }
  | { kind: "match-detail"; matchId: string }
  | { kind: "task-detail"; taskId: string }
  | { kind: "my-stats" }
  | null;

function calendarEventToOverlay(event: CalendarEvent): Overlay {
  switch (event.type) {
    case "training":
      return { kind: "training-detail", trainingId: event.id };
    case "match":
      return { kind: "match-detail", matchId: event.id };
    case "task_deadline":
      return { kind: "task-detail", taskId: event.id };
  }
}

function CoachTabContent({ tab, token, onOpenMyStats }: { tab: CoachTab; token: string; onOpenMyStats: () => void }) {
  switch (tab) {
    case "teams":
      return <TeamsScreen token={token} />;
    case "library":
      return <LibraryScreen token={token} />;
    case "calendar":
      return <CalendarScreen token={token} />;
    case "profile":
      return <ProfileScreen token={token} onOpenMyStats={onOpenMyStats} />;
  }
}

function MainContent({ token }: { token: string }) {
  const { state } = useProfile();
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const [coachTab, setCoachTab] = useState<CoachTab>("teams");
  const [playerTab, setPlayerTab] = useState<PlayerTab>("profile");
  const [overlay, setOverlay] = useState<Overlay>(null);

  if (overlay?.kind === "my-stats" && myUserId) {
    return <PlayerStatsScreen token={token} userId={myUserId} onBack={() => setOverlay(null)} />;
  }

  // Opening a team or a personal training from the profile's own lists
  // takes over the whole screen, same as any other drill-down navigation —
  // closing it returns to whatever was open before.
  if (overlay?.kind === "team") {
    return <TeamDetailScreen token={token} teamId={overlay.teamId} onBack={() => setOverlay(null)} />;
  }

  if (overlay?.kind === "training-create") {
    return (
      <TrainingForm
        token={token}
        mode="personal"
        onSaved={(trainings) =>
          setOverlay(trainings[0] ? { kind: "training-detail", trainingId: trainings[0].id } : null)
        }
        onCancel={() => setOverlay(null)}
      />
    );
  }

  if (overlay?.kind === "training-edit") {
    const training = overlay.training;
    return (
      <TrainingForm
        token={token}
        mode="personal"
        initial={training}
        onSaved={(trainings) =>
          setOverlay(trainings[0] ? { kind: "training-detail", trainingId: trainings[0].id } : null)
        }
        onCancel={() => setOverlay({ kind: "training-detail", trainingId: training.id })}
        onDeleted={() => setOverlay(null)}
      />
    );
  }

  if (overlay?.kind === "training-detail") {
    return (
      <TrainingDetail
        token={token}
        trainingId={overlay.trainingId}
        onBack={() => setOverlay(null)}
        onEdit={(training) => setOverlay({ kind: "training-edit", training })}
      />
    );
  }

  if (overlay?.kind === "match-detail") {
    return (
      <MatchDetail
        token={token}
        matchId={overlay.matchId}
        canManage={false}
        onBack={() => setOverlay(null)}
        onEdit={() => {}}
        onDeleted={() => setOverlay(null)}
      />
    );
  }

  if (overlay?.kind === "task-detail") {
    return (
      <TaskDetail
        token={token}
        taskId={overlay.taskId}
        canManage={false}
        onBack={() => setOverlay(null)}
        onEdit={() => {}}
        onDeleted={() => setOverlay(null)}
      />
    );
  }

  if (state.status === "ready" && state.data.activeMode === "coach") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <CoachTabContent tab={coachTab} token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />
        </div>
        <BottomNav items={COACH_NAV_ITEMS} active={coachTab} onChange={setCoachTab} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {playerTab === "teams" && <MyTeamsScreen token={token} onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })} />}
        {playerTab === "calendar" && (
          <CalendarScreen
            token={token}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
          />
        )}
        {playerTab === "profile" && <ProfileScreen token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />}
      </div>
      <BottomNav items={PLAYER_NAV_ITEMS} active={playerTab} onChange={setPlayerTab} />
    </div>
  );
}

export function Workspace({ token }: { token: string }) {
  const [inviteToken, setInviteToken] = useState<string | null>(readInviteToken);

  const clearInvite = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
    setInviteToken(null);
  };

  return (
    <ProfileProvider token={token}>
      {inviteToken ? (
        <InviteAcceptScreenGate token={token} inviteToken={inviteToken} onDone={clearInvite} />
      ) : (
        <MainContent token={token} />
      )}
    </ProfileProvider>
  );
}

// Invite acceptance needs a profile to exist first (a bare Telegram identity
// is enough to authenticate, but joining a team as a coach/player conceptually
// happens once the person has at least started onboarding).
function InviteAcceptScreenGate({
  token,
  inviteToken,
  onDone,
}: {
  token: string;
  inviteToken: string;
  onDone: () => void;
}) {
  const { state } = useProfile();

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }

  return <InviteAcceptScreen token={token} inviteToken={inviteToken} onDone={onDone} />;
}
