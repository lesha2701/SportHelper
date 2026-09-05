import { useEffect, useState, type ReactNode } from "react";
import { ProfileProvider, useProfile } from "./context/ProfileContext";
import { useAuth } from "./context/AuthContext";
import { ProfileScreen } from "./components/profile/ProfileScreen";
import { DashboardScreen } from "./components/dashboard/DashboardScreen";
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
import type { NavItem } from "./components/nav/BottomNav";
import { AppShell } from "./components/nav/AppShell";
import type { Training } from "./types/training";
import type { CalendarEvent } from "./types/calendar";

function readInviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("invite");
}

type CoachTab = "dashboard" | "teams" | "library" | "calendar" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why. "Главная" (dashboard) was added in the MBA redesign,
// see docs/superpowers/specs/2026-08-17-mba-redesign-design.md.
type PlayerTab = "dashboard" | "teams" | "calendar" | "profile";

const COACH_NAV_ITEMS: NavItem<CoachTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "library", label: "Библиотека", icon: "book" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
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

function CoachTabContent({
  tab,
  token,
  userId,
  onOpenMyStats,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
}: {
  tab: CoachTab;
  token: string;
  userId: string;
  onOpenMyStats: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
}) {
  switch (tab) {
    case "dashboard":
      return (
        <DashboardScreen
          token={token}
          userId={userId}
          onOpenEvent={onOpenEvent}
          onOpenTeam={onOpenTeam}
          onCreateTraining={onCreateTraining}
          onOpenMyStats={onOpenMyStats}
        />
      );
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
  const [coachTab, setCoachTab] = useState<CoachTab>("dashboard");
  const [playerTab, setPlayerTab] = useState<PlayerTab>("dashboard");

  // A brand-new user (no player or coach profile yet) should land on
  // Онбординг (via the Профиль tab), not a dashboard full of zeros —
  // this only fires once, when the profile finishes loading empty;
  // it never overrides navigation after that.
  useEffect(() => {
    if (state.status === "ready" && !state.data.player && !state.data.coach) {
      setPlayerTab("profile");
    }
  }, [state]);

  const [overlay, setOverlay] = useState<Overlay>(null);

  // Computed once so both the coach and player AppShell branches below
  // render the same overlay content — desktop keeps the sidebar mounted
  // around it, mobile (via AppShell's hasOverlay branch) still shows it
  // full-screen exactly as before.
  let overlayContent: ReactNode = null;
  if (overlay?.kind === "my-stats" && myUserId) {
    overlayContent = <PlayerStatsScreen token={token} userId={myUserId} onBack={() => setOverlay(null)} />;
  } else if (overlay?.kind === "team") {
    overlayContent = <TeamDetailScreen token={token} teamId={overlay.teamId} onBack={() => setOverlay(null)} />;
  } else if (overlay?.kind === "training-create") {
    overlayContent = (
      <TrainingForm
        token={token}
        mode="personal"
        onSaved={(trainings) =>
          setOverlay(trainings[0] ? { kind: "training-detail", trainingId: trainings[0].id } : null)
        }
        onCancel={() => setOverlay(null)}
      />
    );
  } else if (overlay?.kind === "training-edit") {
    const training = overlay.training;
    overlayContent = (
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
  } else if (overlay?.kind === "training-detail") {
    overlayContent = (
      <TrainingDetail
        token={token}
        trainingId={overlay.trainingId}
        onBack={() => setOverlay(null)}
        onEdit={(training) => setOverlay({ kind: "training-edit", training })}
      />
    );
  } else if (overlay?.kind === "match-detail") {
    overlayContent = (
      <MatchDetail
        token={token}
        matchId={overlay.matchId}
        canManage={false}
        onBack={() => setOverlay(null)}
        onEdit={() => {}}
        onDeleted={() => setOverlay(null)}
      />
    );
  } else if (overlay?.kind === "task-detail") {
    overlayContent = (
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

  const hasOverlay = overlayContent !== null;

  if (state.status === "ready" && state.data.activeMode === "coach") {
    return (
      <AppShell
        navItems={COACH_NAV_ITEMS}
        activeTab={coachTab}
        onChangeTab={(tab) => {
          setOverlay(null);
          setCoachTab(tab);
        }}
        hasOverlay={hasOverlay}
      >
        {overlayContent ?? (
          <CoachTabContent
            tab={coachTab}
            token={token}
            userId={myUserId ?? ""}
            onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
          />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      navItems={PLAYER_NAV_ITEMS}
      activeTab={playerTab}
      onChangeTab={(tab) => {
        setOverlay(null);
        setPlayerTab(tab);
      }}
      hasOverlay={hasOverlay}
    >
      {overlayContent ?? (
        <>
          {playerTab === "dashboard" && myUserId && (
            <DashboardScreen
              token={token}
              userId={myUserId}
              onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
              onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
              onCreateTraining={() => setOverlay({ kind: "training-create" })}
              onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
            />
          )}
          {playerTab === "teams" && (
            <MyTeamsScreen token={token} onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })} />
          )}
          {playerTab === "calendar" && (
            <CalendarScreen
              token={token}
              onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
              onCreateTraining={() => setOverlay({ kind: "training-create" })}
            />
          )}
          {playerTab === "profile" && (
            <ProfileScreen token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />
          )}
        </>
      )}
    </AppShell>
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
