import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { CoachMarketplaceScreen } from "./components/coaches/CoachMarketplaceScreen";
import { IncomingBookingsScreen } from "./components/coaches/IncomingBookingsScreen";
import { MyBookingsSection } from "./components/coaches/MyBookingsSection";
import { searchAll, type SearchResult } from "./api/search";
import { subscribeAppNav } from "./appNav";
import { notificationToOverlay, type Overlay } from "./overlay";
import { NotificationsScreen } from "./components/notifications/NotificationsScreen";
import { StateScreen } from "./components/StateScreen";
import type { NavItem } from "./components/nav/BottomNav";
import type { SideNavTeam, SideNavUser } from "./components/nav/SideNav";
import type { TopBarConfig } from "./components/nav/TopBar";
import { AppShell } from "./components/nav/AppShell";
import { listMyTeams } from "./api/teams";
import { listCoachPendingBookings } from "./api/bookings";
import { listNotifications } from "./api/notifications";
import { TEAM_ROLE_LABELS, type Team } from "./types/team";
import type { CalendarEvent } from "./types/calendar";
import type { NotificationCategory } from "./types/notification";

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function dateKicker(): string {
  const s = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthKicker(): string {
  const s = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function readInviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("invite");
}

interface DeepLink {
  category: NotificationCategory;
  entityId: string;
}

/** Consumed once, from either a Telegram notification's "Открыть в
 * приложении" button (see backend/app/services/background.py) or a bell
 * click on the site itself. `open` carries the notification's category
 * (not entity_type) since that's what disambiguates booking_requested
 * from booking_decided — same entity_type ("booking"), different target
 * screen depending on which side of the booking the recipient is on. */
function readNotificationDeepLink(): DeepLink | null {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("open");
  const entityId = params.get("id");
  if (!category || !entityId) return null;
  return { category: category as NotificationCategory, entityId };
}

type CoachTab = "dashboard" | "teams" | "library" | "calendar" | "coaches" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why. "Главная" (dashboard) was added in the MBA redesign,
// see docs/superpowers/specs/2026-08-17-mba-redesign-design.md.
type PlayerTab = "dashboard" | "teams" | "calendar" | "coaches" | "profile";

const COACH_NAV_ITEMS: NavItem<CoachTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "library", label: "Библиотека", icon: "book" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "coaches", label: "Тренеры", icon: "users" },
  { key: "profile", label: "Профиль", icon: "user" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "coaches", label: "Тренеры", icon: "users" },
  { key: "profile", label: "Профиль", icon: "user" },
];

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

function coachTopBar(tab: CoachTab, onCreateTraining: () => void): TopBarConfig {
  switch (tab) {
    case "dashboard":
      return { kicker: dateKicker(), title: "Тренерская панель", cta: { label: "Тренировка", icon: "plus", onClick: onCreateTraining } };
    case "teams":
      return { kicker: "Команды", title: "Команды" };
    case "library":
      return { kicker: "Упражнения, планы, шаблоны", title: "Библиотека" };
    case "calendar":
      return { kicker: monthKicker(), title: "Календарь" };
    case "coaches":
      return { kicker: "Индивидуальные занятия", title: "Тренеры" };
    case "profile":
      return { kicker: "Аккаунт", title: "Профиль" };
  }
}

function playerTopBar(tab: PlayerTab, onCreateTraining: () => void): TopBarConfig {
  switch (tab) {
    case "dashboard":
      return { kicker: dateKicker(), title: "Твой прогресс", cta: { label: "Тренировка", icon: "plus", onClick: onCreateTraining } };
    case "teams":
      return { kicker: "Команды", title: "Команды" };
    case "calendar":
      return { kicker: monthKicker(), title: "Календарь" };
    case "coaches":
      return { kicker: "Индивидуальные занятия", title: "Тренеры" };
    case "profile":
      return { kicker: "Аккаунт", title: "Профиль" };
  }
}

function CoachTabContent({
  initialCoachUserId,
  tab,
  token,
  userId,
  onOpenMyStats,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
  onOpenNotifications,
  unreadNotifications,
}: {
  initialCoachUserId: string | null;
  tab: CoachTab;
  token: string;
  userId: string;
  onOpenMyStats: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
  onOpenNotifications: () => void;
  unreadNotifications: number;
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
    case "coaches":
      return <CoachMarketplaceScreen key={initialCoachUserId ?? "list"} token={token} initialCoachUserId={initialCoachUserId} />;
    case "profile":
      return (
        <ProfileScreen
          token={token}
          onOpenMyStats={onOpenMyStats}
          onOpenNotifications={onOpenNotifications}
          unreadNotifications={unreadNotifications}
        />
      );
  }
}

function MainContent({
  token,
  deepLink,
  initialTeamId,
}: {
  token: string;
  deepLink: DeepLink | null;
  initialTeamId?: string | null;
}) {
  const { state } = useProfile();
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const myPhotoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const [coachTab, setCoachTab] = useState<CoachTab>("dashboard");
  const [playerTab, setPlayerTab] = useState<PlayerTab>("dashboard");

  const [teams, setTeams] = useState<Team[] | null>(null);
  useEffect(() => {
    listMyTeams(token)
      .then(setTeams)
      .catch(() => setTeams([]));
  }, [token]);

  const isCoachMode = state.status === "ready" && state.data.activeMode === "coach";
  const [pendingBookings, setPendingBookings] = useState(0);
  useEffect(() => {
    if (!isCoachMode) {
      setPendingBookings(0);
      return;
    }
    listCoachPendingBookings(token)
      .then((bookings) => setPendingBookings(bookings.length))
      .catch(() => setPendingBookings(0));
  }, [token, isCoachMode]);

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const refreshUnreadNotifications = () => {
    listNotifications(token)
      .then((items) => setUnreadNotifications(items.filter((n) => !n.readAt).length))
      .catch(() => {});
  };
  useEffect(() => {
    refreshUnreadNotifications();
    const interval = setInterval(refreshUnreadNotifications, 45000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const primaryTeam = teams && teams.length > 0 ? teams[0]! : null;
  const sideTeam: SideNavTeam | null = primaryTeam
    ? {
        name: primaryTeam.name,
        roleLabel: primaryTeam.myRole ? TEAM_ROLE_LABELS[primaryTeam.myRole] : "Участник",
        initial: initialOf(primaryTeam.name),
      }
    : null;

  let sideUser: SideNavUser = { name: "…", sub: "", photoUrl: myPhotoUrl, initial: "?" };
  if (state.status === "ready") {
    const mode = state.data.activeMode ?? (state.data.player ? "player" : "coach");
    if (mode === "player" && state.data.player) {
      sideUser = { name: state.data.player.fullName, sub: "Игрок", photoUrl: myPhotoUrl, initial: initialOf(state.data.player.fullName) };
    } else if (mode === "coach" && state.data.coach) {
      sideUser = { name: state.data.coach.fullName, sub: "Тренер", photoUrl: myPhotoUrl, initial: initialOf(state.data.coach.fullName) };
    }
  }

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
  const closeOverlay = () => setOverlay(overlay?.backTo ?? null);
  const isStaffOfTeam = (teamId: string) =>
    (teams ?? []).some((t) => t.id === teamId && (t.myRole === "head_coach" || t.myRole === "assistant_coach"));
  // Set when a search result opens a coach's profile in the marketplace tab.
  const [marketplaceCoachId, setMarketplaceCoachId] = useState<string | null>(null);

  // A Telegram notification button (or a page freshly opened with
  // ?open=&id= from anywhere else) should jump straight to the relevant
  // screen exactly once, on the first render after it appears — never
  // re-triggered by later state changes (e.g. switching tabs afterward).
  const appliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!deepLink || appliedDeepLinkRef.current) return;
    appliedDeepLinkRef.current = true;
    const target = notificationToOverlay(deepLink.category, deepLink.entityId);
    if (target) setOverlay(target);
  }, [deepLink]);

  const initialTeamAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialTeamId || initialTeamAppliedRef.current) return;
    initialTeamAppliedRef.current = true;
    setOverlay({ kind: "team", teamId: initialTeamId });
  }, [initialTeamId]);

  // Computed once so both the coach and player AppShell branches below
  // render the same overlay content — desktop keeps the sidebar mounted
  // around it, mobile (via AppShell's hasOverlay branch) still shows it
  // full-screen exactly as before.
  let overlayContent: ReactNode = null;
  if (overlay?.kind === "my-stats" && myUserId) {
    overlayContent = <PlayerStatsScreen token={token} userId={myUserId} onBack={closeOverlay} />;
  } else if (overlay?.kind === "team") {
    overlayContent = <TeamDetailScreen token={token} teamId={overlay.teamId} onBack={closeOverlay} />;
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
        onBack={closeOverlay}
        onEdit={(training) => setOverlay({ kind: "training-edit", training })}
      />
    );
  } else if (overlay?.kind === "match-detail") {
    overlayContent = (
      <MatchDetail
        token={token}
        matchId={overlay.matchId}
        canManage={isStaffOfTeam}
        onBack={closeOverlay}
        onEdit={() => {}}
        onDeleted={closeOverlay}
      />
    );
  } else if (overlay?.kind === "task-detail") {
    overlayContent = (
      <TaskDetail
        token={token}
        taskId={overlay.taskId}
        canManage={isStaffOfTeam}
        onBack={closeOverlay}
        onEdit={() => {}}
        onDeleted={closeOverlay}
      />
    );
  } else if (overlay?.kind === "notifications") {
    overlayContent = (
      <NotificationsScreen
        token={token}
        onBack={() => {
          setOverlay(null);
          refreshUnreadNotifications();
        }}
        onOpen={(notification) => {
          setUnreadNotifications((prev) => Math.max(0, prev - (notification.readAt ? 0 : 1)));
          const target = notificationToOverlay(notification.category, notification.entityId);
          setOverlay(target ? { ...target, backTo: { kind: "notifications" } } : null);
        }}
      />
    );
  } else if (overlay?.kind === "incoming-bookings") {
    overlayContent = <IncomingBookingsScreen token={token} onBack={closeOverlay} focusBookingId={overlay.focusBookingId} />;
  } else if (overlay?.kind === "my-bookings") {
    overlayContent = (
      <MyBookingsSection
        token={token}
        onBack={closeOverlay}
        reviewBookingId={overlay.reviewBookingId}
        focusBookingId={overlay.focusBookingId}
      />
    );
  }

  const hasOverlay = overlayContent !== null;

  // Anything in the app can send the user elsewhere (a toast action, a success
  // card's button, an empty state) without knowing the shell's layout.
  useEffect(
    () =>
      subscribeAppNav((target) => {
        switch (target.kind) {
          case "tab":
            setOverlay(null);
            setMarketplaceCoachId(null);
            if (isCoachMode) setCoachTab(target.tab);
            else setPlayerTab(target.tab);
            break;
          case "training":
            setOverlay({ kind: "training-detail", trainingId: target.trainingId });
            break;
          case "training-create":
            setOverlay({ kind: "training-create" });
            break;
          case "my-bookings":
            setOverlay({ kind: "my-bookings" });
            break;
          case "incoming-bookings":
            setOverlay({ kind: "incoming-bookings" });
            break;
        }
      }),
    [isCoachMode],
  );
  const handleSearchSelect = (result: SearchResult) => {
    switch (result.type) {
      case "team":
        setOverlay({ kind: "team", teamId: result.id });
        break;
      case "player":
        // A teammate has no public profile of their own — land on the shared team.
        if (result.teamId) setOverlay({ kind: "team", teamId: result.teamId });
        break;
      case "training":
        setOverlay({ kind: "training-detail", trainingId: result.id });
        break;
      case "match":
        setOverlay({ kind: "match-detail", matchId: result.id });
        break;
      case "task":
        setOverlay({ kind: "task-detail", taskId: result.id });
        break;
      case "coach":
        setOverlay(null);
        setMarketplaceCoachId(result.id);
        if (isCoachMode) setCoachTab("coaches");
        else setPlayerTab("coaches");
        break;
      case "exercise":
        setOverlay(null);
        setCoachTab("library");
        break;
    }
  };
  const searchConfig = {
    run: (query: string) =>
      searchAll(token, query).then((found) => (isCoachMode ? found : found.filter((r) => r.type !== "exercise"))),
    onSelect: handleSearchSelect,
  };
  const onCreateTraining = () => setOverlay({ kind: "training-create" });
  const onOpenTeam = primaryTeam ? () => setOverlay({ kind: "team", teamId: primaryTeam.id }) : undefined;

  if (state.status === "ready" && state.data.activeMode === "coach") {
    const coachNavItems = COACH_NAV_ITEMS.map((item) => (item.key === "profile" ? { ...item, badge: pendingBookings } : item));
    return (
      <AppShell
        navItems={coachNavItems}
        activeTab={coachTab}
        onChangeTab={(tab) => {
          setOverlay(null);
          setMarketplaceCoachId(null);
          setCoachTab(tab);
        }}
        hasOverlay={hasOverlay}
        sideTeam={sideTeam}
        onOpenTeam={onOpenTeam}
        sideUser={sideUser}
        onOpenProfile={() => {
          setOverlay(null);
          setCoachTab("profile");
        }}
        topBar={
          hasOverlay
            ? undefined
            : {
                ...coachTopBar(coachTab, onCreateTraining),
                unreadNotifications,
                onOpenNotifications: () => setOverlay({ kind: "notifications" }),
                search: searchConfig,
              }
        }
      >
        {overlayContent ?? (
          <CoachTabContent
            initialCoachUserId={marketplaceCoachId}
            tab={coachTab}
            token={token}
            userId={myUserId ?? ""}
            onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
            onCreateTraining={onCreateTraining}
            onOpenNotifications={() => setOverlay({ kind: "notifications" })}
            unreadNotifications={unreadNotifications}
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
        setMarketplaceCoachId(null);
        setPlayerTab(tab);
      }}
      hasOverlay={hasOverlay}
      sideTeam={sideTeam}
      onOpenTeam={onOpenTeam}
      sideUser={sideUser}
      onOpenProfile={() => {
        setOverlay(null);
        setPlayerTab("profile");
      }}
      topBar={
        hasOverlay
          ? undefined
          : {
              ...playerTopBar(playerTab, onCreateTraining),
              unreadNotifications,
              onOpenNotifications: () => setOverlay({ kind: "notifications" }),
              search: searchConfig,
            }
      }
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
          {playerTab === "coaches" && (
            <CoachMarketplaceScreen key={marketplaceCoachId ?? "list"} token={token} initialCoachUserId={marketplaceCoachId} />
          )}
          {playerTab === "profile" && (
            <ProfileScreen
              token={token}
              onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
              onOpenNotifications={() => setOverlay({ kind: "notifications" })}
              unreadNotifications={unreadNotifications}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

export function Workspace({ token }: { token: string }) {
  const [inviteToken, setInviteToken] = useState<string | null>(readInviteToken);
  const [deepLink] = useState<DeepLink | null>(readNotificationDeepLink);

  // Set when the person has just joined a team through an invite: the app opens straight on it.
  const [teamToOpen, setTeamToOpen] = useState<string | null>(null);

  const clearInvite = (teamId?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
    if (teamId) setTeamToOpen(teamId);
    setInviteToken(null);
  };

  // Strip ?open=&id= from the URL once read — same spirit as clearInvite,
  // just without needing to gate anything else on it first.
  useEffect(() => {
    if (!deepLink) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    url.searchParams.delete("id");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ProfileProvider token={token}>
      {inviteToken ? (
        <InviteAcceptScreenGate token={token} inviteToken={inviteToken} onDone={clearInvite} />
      ) : (
        <MainContent token={token} deepLink={deepLink} initialTeamId={teamToOpen} />
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
  onDone: (teamId?: string) => void;
}) {
  const { state } = useProfile();

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }

  return <InviteAcceptScreen token={token} inviteToken={inviteToken} onDone={onDone} />;
}
