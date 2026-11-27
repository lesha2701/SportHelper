import { HeadingActionVisibility } from "./hooks/useHeadingAction";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ProfileProvider, useProfile } from "./context/ProfileContext";
import { useAuth } from "./context/AuthContext";
import { ProfileScreen } from "./components/profile/ProfileScreen";
import { DashboardScreen } from "./components/dashboard/DashboardScreen";
import { TeamDetailScreen } from "./components/teams/TeamDetailScreen";
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
import { FinanceScreen } from "./components/finance/FinanceScreen";
import { MatchOffersScreen } from "./components/coaches/MatchOffersScreen";
import { MatchRequestScreen } from "./components/coaches/MatchRequestScreen";
import { TitleWithBack } from "./components/shared/BackArrow";
import profileStyles from "./components/profile/profile.module.css";
import { ChatScreen } from "./components/chat/ChatScreen";
import { useFinanceFeatures } from "./features";
import { NotificationsScreen } from "./components/notifications/NotificationsScreen";
import { StateScreen } from "./components/StateScreen";
import type { NavItem } from "./components/nav/BottomNav";
import type { SideNavUser } from "./components/nav/SideNav";
import type { TopBarConfig } from "./components/nav/TopBar";
import { AppShell } from "./components/nav/AppShell";
import { listMyTeams } from "./api/teams";
import { listCoachPendingBookings } from "./api/bookings";
import { listNotifications } from "./api/notifications";
import type { Team } from "./types/team";
import { BlogApp } from "./components/blog/BlogApp";
import type { CalendarEvent } from "./types/calendar";
import type { NotificationCategory } from "./types/notification";
import { navigate, useLocation } from "./router";
import { useActivityPing } from "./hooks/useActivityPing";
import { loadView, saveView } from "./lib/viewState";
import { TEAM_FEATURES_VISIBLE, isVisibleNotification, isVisibleSearchResult } from "./featureVisibility";
/** A notification about an article: the blog lives on its own addresses, so this just hands over to it. */
function BlogPostRedirect({ postId, onOpen }: { postId: string; onOpen: () => void }) {
  useEffect(() => {
    onOpen();
    navigate(`/blog/${postId}`);
  }, [postId, onOpen]);
  return null;
}

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
  return TEAM_FEATURES_VISIBLE ? new URLSearchParams(window.location.search).get("invite") : null;
}

interface DeepLink {
  category: NotificationCategory;
  entityId: string;
}

/** What the visitor was heading for in the coach catalogue before signing in
 * (or from a shared link): a coach's profile, a listing, or straight to its booking form. */
interface MarketplaceIntent {
  coachUserId: string | null;
  listingId: string | null;
  bookListingId: string | null;
}

function readMarketplaceIntent(): MarketplaceIntent | null {
  const params = new URLSearchParams(window.location.search);
  const intent = { coachUserId: params.get("coach"), listingId: params.get("listing"), bookListingId: params.get("book") };
  return intent.coachUserId || intent.listingId || intent.bookListingId ? intent : null;
}

/** Consumed once, from either a notification's "Открыть на сайте"
 * button (see backend/app/services/background.py) or a bell
 * click on the site itself. `open` carries the notification's category
 * (not entity_type) since that's what disambiguates booking_requested
 * from booking_decided — same entity_type ("booking"), different target
 * screen depending on which side of the booking the recipient is on. */
function readNotificationDeepLink(): DeepLink | null {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("open");
  const entityId = params.get("id");
  if (!category || !entityId || !isVisibleNotification({ category })) return null;
  return { category: category as NotificationCategory, entityId };
}

type CoachTab = "dashboard" | "library" | "calendar" | "coaches" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why. "Главная" (dashboard) was added in the MBA redesign,
// see docs/superpowers/specs/2026-08-17-mba-redesign-design.md.
type PlayerTab = "dashboard" | "calendar" | "coaches" | "profile";

const COACH_NAV_ITEMS: NavItem<CoachTab | "blog">[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "blog", label: "Статьи", icon: "book" },
  { key: "library", label: "Библиотека", icon: "book" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "coaches", label: "Тренеры", icon: "users" },
  { key: "profile", label: "Профиль", icon: "user" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab | "blog">[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "blog", label: "Статьи", icon: "book" },
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

function withoutHeadingAction(config: TopBarConfig, hide: boolean): TopBarConfig {
  return hide ? { ...config, cta: undefined } : config;
}

/** `onHeadingAction` is the tab's main button in the page heading (create a listing / a library item / a team): the open screen listens for it. */
function coachTopBar(tab: CoachTab, onCreateTraining: () => void, onHeadingAction: () => void): TopBarConfig {
  switch (tab) {
    case "dashboard":
      return { kicker: dateKicker(), title: "Тренерская панель", cta: { label: "Тренировка", icon: "plus", onClick: onCreateTraining } };
    case "library":
      return { kicker: TEAM_FEATURES_VISIBLE ? "Упражнения, планы, шаблоны" : "Упражнения и планы", title: "Библиотека", cta: { label: "Создать", icon: "plus", onClick: onHeadingAction } };
    case "calendar":
      return { kicker: monthKicker(), title: "Календарь", cta: { label: "Добавить тренировку", icon: "plus", onClick: onCreateTraining } };
    case "coaches":
      return { kicker: "Индивидуальные занятия", title: "Тренеры", cta: { label: "Создать объявление", icon: "plus", onClick: onHeadingAction } };
    case "profile":
      return { kicker: "Аккаунт", title: "Профиль" };
  }
}

function playerTopBar(tab: PlayerTab, onCreateTraining: () => void): TopBarConfig {
  switch (tab) {
    case "dashboard":
      return { kicker: dateKicker(), title: "Твой прогресс", cta: { label: "Тренировка", icon: "plus", onClick: onCreateTraining } };
    case "calendar":
      return { kicker: monthKicker(), title: "Календарь", cta: { label: "Добавить тренировку", icon: "plus", onClick: onCreateTraining } };
    case "coaches":
      return { kicker: "Индивидуальные занятия", title: "Тренеры" };
    case "profile":
      return { kicker: "Аккаунт", title: "Профиль" };
  }
}

export function CoachTabContent({
  initialCoachUserId,
  marketplaceStart,
  tab,
  token,
  userId,
  onOpenMyStats,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
  onOpenNotifications,
  unreadNotifications,
  startProfileInSettings,
  onProfileSettingsOpened,
  headingRequest,
}: {
  initialCoachUserId: string | null;
  marketplaceStart: MarketplaceIntent | null;
  tab: CoachTab;
  token: string;
  userId: string;
  onOpenMyStats: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
  onOpenNotifications: () => void;
  unreadNotifications: number;
  startProfileInSettings: boolean;
  onProfileSettingsOpened: () => void;
  /** Bumped each time the tab's main button in the page heading is pressed (see coachTopBar). */
  headingRequest?: number;
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
    case "library":
      return <LibraryScreen token={token} createRequest={headingRequest} />;
    case "calendar":
      return <CalendarScreen token={token} onOpenEvent={onOpenEvent} onCreateTraining={onCreateTraining} />;
    case "coaches":
      return (
        <CoachMarketplaceScreen
          key={`${initialCoachUserId ?? "list"}|${marketplaceStart?.listingId ?? ""}|${marketplaceStart?.bookListingId ?? ""}`}
          token={token}
          initialCoachUserId={initialCoachUserId}
          initialListingId={marketplaceStart?.listingId ?? null}
          initialBookListingId={marketplaceStart?.bookListingId ?? null}
          myUserId={userId}
          canCreateListing
          createListingRequest={headingRequest}
        />
      );
    case "profile":
      return (
        <ProfileScreen
          token={token}
          onOpenMyStats={onOpenMyStats}
          onOpenNotifications={onOpenNotifications}
          unreadNotifications={unreadNotifications}
          startInSettings={startProfileInSettings}
          onSettingsOpened={onProfileSettingsOpened}
        />
      );
  }
}

function MainContent({
  token,
  deepLink,
  initialTeamId,
  marketplaceIntent,
  blogPath,
}: {
  blogPath: string | null;
  token: string;
  deepLink: DeepLink | null;
  initialTeamId?: string | null;
  marketplaceIntent: MarketplaceIntent | null;
}) {
  const { state } = useProfile();
  const { state: authState } = useAuth();
  const { trainerBalance } = useFinanceFeatures();
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const myPhotoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const myAvatarFileId = authState.status === "ready" ? authState.user.avatarFileId : null;
  const myAvatar = myAvatarFileId ? { token, fileId: myAvatarFileId } : null;
  useActivityPing(authState.status === "ready");
  const openAdmin = authState.status === "ready" && authState.user.isAdmin ? () => navigate("/admin") : undefined;
  // A reload returns to the screen the person was on; a link (invite, notification, coach page) takes priority over that.
  const [savedView] = useState(() =>
    loadView(
      myUserId,
      COACH_NAV_ITEMS.flatMap((item) => item.key === "blog" ? [] : [item.key]),
      PLAYER_NAV_ITEMS.flatMap((item) => item.key === "blog" ? [] : [item.key]),
    ),
  );
  const startsFromLink = !!(marketplaceIntent || deepLink || initialTeamId);
  const [coachTab, setCoachTab] = useState<CoachTab>(marketplaceIntent ? "coaches" : (savedView.coachTab ?? "dashboard"));
  const [playerTab, setPlayerTab] = useState<PlayerTab>(marketplaceIntent ? "coaches" : (savedView.playerTab ?? "dashboard"));
  // The sidebar gear opens the profile tab straight on its settings screen.
  // Tapping the tab you are already on returns it to its first screen: the content is made again under a new key.
  const [tabResetKey, setTabResetKey] = useState(0);
  const [profileSettingsRequested, setProfileSettingsRequested] = useState(false);
  const clearProfileSettingsRequest = useCallback(() => setProfileSettingsRequested(false), []);

  const [teams, setTeams] = useState<Team[] | null>(null);
  useEffect(() => {
    if (!TEAM_FEATURES_VISIBLE) { setTeams([]); return; }
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
      .then((items) => setUnreadNotifications(items.filter((n) => !n.readAt && isVisibleNotification(n)).length))
      .catch(() => {});
  };
  useEffect(() => {
    refreshUnreadNotifications();
    const interval = setInterval(refreshUnreadNotifications, 45000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  let sideUser: SideNavUser = { name: "…", sub: "", photoUrl: myPhotoUrl, avatar: myAvatar, initial: "?" };
  if (state.status === "ready") {
    const mode = state.data.activeMode ?? (state.data.player ? "player" : "coach");
    if (mode === "player" && state.data.player) {
      sideUser = { name: state.data.player.fullName, sub: "Игрок", photoUrl: myPhotoUrl, avatar: myAvatar, initial: initialOf(state.data.player.fullName) };
    } else if (mode === "coach" && state.data.coach) {
      sideUser = { name: state.data.coach.fullName, sub: "Тренер", photoUrl: myPhotoUrl, avatar: myAvatar, initial: initialOf(state.data.coach.fullName) };
    }
  }

  // A brand-new user (no player or coach profile yet) should land on
  // Онбординг (via the Профиль tab), not a dashboard full of zeros —
  // this only fires once, when the profile finishes loading empty;
  // it never overrides navigation after that.
  useEffect(() => {
    if (state.status === "ready" && !state.data.player && !state.data.coach && !marketplaceIntent) {
      setPlayerTab("profile");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const [overlay, setOverlay] = useState<Overlay>(startsFromLink ? null : (savedView.overlay && (TEAM_FEATURES_VISIBLE || !["team", "match-detail", "task-detail"].includes(savedView.overlay.kind)) ? savedView.overlay : null));
  useEffect(() => {
    saveView(myUserId, { coachTab, playerTab, overlay });
  }, [myUserId, coachTab, playerTab, overlay]);
  const { search: routeSearch } = useLocation();
  const blogFeedUrl = useRef("/blog");
  useEffect(() => {
    if (blogPath === "/blog") blogFeedUrl.current = `/blog${routeSearch}`;
  }, [blogPath, routeSearch]);
  const openBlog = () => {
    if (blogPath !== "/blog") navigate(blogFeedUrl.current);
  };
  const leaveBlog = useCallback(() => {
    if (blogPath) navigate("/");
  }, [blogPath]);
  const clearOverlay = useCallback(() => setOverlay(null), []);
  const closeOverlay = () => setOverlay(overlay?.backTo ?? null);
  const isStaffOfTeam = (teamId: string) =>
    (teams ?? []).some((t) => t.id === teamId && (t.myRole === "head_coach" || t.myRole === "assistant_coach"));
  // Set when a search result opens a coach's profile in the marketplace tab,
  // or when the visitor arrives with a link to a coach / listing / booking.
  const [marketplaceCoachId, setMarketplaceCoachId] = useState<string | null>(marketplaceIntent?.coachUserId ?? null);
  const [marketplaceStart, setMarketplaceStart] = useState<MarketplaceIntent | null>(marketplaceIntent);
  // The tab's main button lives in the page heading; each press bumps this so the open screen starts its create form.
  const [headingRequest, setHeadingRequest] = useState(0);
  const [headingActionVisible, setHeadingActionVisible] = useState(true);

  // A notification button (or a page freshly opened with
  // ?open=&id= from anywhere else) should jump straight to the relevant
  // screen exactly once, on the first render after it appears — never
  // re-triggered by later state changes (e.g. switching tabs afterward).
  const appliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!deepLink || appliedDeepLinkRef.current) return;
    appliedDeepLinkRef.current = true;
    const target = notificationToOverlay(deepLink.category, deepLink.entityId);
    if (target && (TEAM_FEATURES_VISIBLE || !["team", "match-detail", "task-detail"].includes(target.kind))) setOverlay(target);
  }, [deepLink]);

  const initialTeamAppliedRef = useRef(false);
  useEffect(() => {
    if (!TEAM_FEATURES_VISIBLE || !initialTeamId || initialTeamAppliedRef.current) return;
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
  } else if (TEAM_FEATURES_VISIBLE && overlay?.kind === "team") {
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
  } else if (TEAM_FEATURES_VISIBLE && overlay?.kind === "match-detail") {
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
  } else if (TEAM_FEATURES_VISIBLE && overlay?.kind === "task-detail") {
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
          const target = isVisibleNotification(notification) ? notificationToOverlay(notification.category, notification.entityId) : null;
          setOverlay(target ? { ...target, backTo: { kind: "notifications" } } : null);
        }}
      />
    );
  } else if (overlay?.kind === "incoming-bookings") {
    overlayContent = <IncomingBookingsScreen token={token} onBack={closeOverlay} focusBookingId={overlay.focusBookingId} />;
  } else if (overlay?.kind === "chat" && myUserId) {
    overlayContent = <ChatScreen token={token} target={overlay.target} myUserId={myUserId} onBack={closeOverlay} />;
  } else if (overlay?.kind === "finance") {
    overlayContent = <FinanceScreen token={token} onBack={closeOverlay} />;
  } else if (overlay?.kind === "blog-post") {
    overlayContent = <BlogPostRedirect postId={overlay.postId} onOpen={clearOverlay} />;
  } else if (overlay?.kind === "match-offers") {
    overlayContent = <MatchOffersScreen onBack={closeOverlay} />;
  } else if (overlay?.kind === "match-requests") {
    overlayContent = (
      <div className={profileStyles.screen}>
        <TitleWithBack onBack={closeOverlay}>
          <h1 className={profileStyles.pageHeading}>Подбор тренера</h1>
        </TitleWithBack>
        <MatchRequestScreen
          onOpenCoach={(coachUserId) => {
            setOverlay(null);
            setMarketplaceStart(null);
            setMarketplaceCoachId(coachUserId);
            setPlayerTab("coaches");
          }}
        />
      </div>
    );
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

  const hasOverlay = !blogPath && overlayContent !== null;
  const blogContent = blogPath ? <BlogApp embedded path={blogPath} /> : null;

  // Anything in the app can send the user elsewhere (a toast action, a success
  // card's button, an empty state) without knowing the shell's layout.
  useEffect(
    () =>
      subscribeAppNav((target) => {
        leaveBlog();
        switch (target.kind) {
          case "tab":
            setOverlay(null);
            setMarketplaceCoachId(null);
            setMarketplaceStart(null);
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
          case "finance":
            setOverlay({ kind: "finance" });
            break;
          case "match-offers":
            setOverlay({ kind: "match-offers" });
            break;
        }
      }),
    [isCoachMode, leaveBlog],
  );
  const handleSearchSelect = (result: SearchResult) => {
    if (!isVisibleSearchResult(result)) return;
    leaveBlog();
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
        setMarketplaceStart(null);
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
      searchAll(token, query).then((found) => (isCoachMode ? found : found.filter((r) => r.type !== "exercise")).filter(isVisibleSearchResult)),
    onSelect: handleSearchSelect,
  };
  const onCreateTraining = () => setOverlay({ kind: "training-create" });
  const openTopOverlay = (kind: "notifications" | "finance") => {
    leaveBlog();
    setOverlay({ kind });
  };

  if (state.status === "ready" && state.data.activeMode === "coach") {
    const coachNavItems = COACH_NAV_ITEMS.map((item) => (item.key === "profile" ? { ...item, badge: pendingBookings } : item));
    return (
      <HeadingActionVisibility.Provider value={setHeadingActionVisible}>
      <AppShell
        navItems={coachNavItems}
        activeTab={blogPath ? "blog" : coachTab}
        onChangeTab={(tab) => {
          if (tab === "blog") {
            openBlog();
            return;
          }
          leaveBlog();
          setOverlay(null);
          setMarketplaceCoachId(null);
          setMarketplaceStart(null);
          if (tab === coachTab) setTabResetKey((key) => key + 1);
          setCoachTab(tab);
        }}
        hasOverlay={hasOverlay}
        hidePageHeading={!!blogPath}
        sideUser={sideUser}
        onOpenAdmin={openAdmin}
        onOpenProfile={() => {
          leaveBlog();
          setOverlay(null);
          setCoachTab("profile");
        }}
        onOpenSettings={() => {
          leaveBlog();
          setOverlay(null);
          setCoachTab("profile");
          setProfileSettingsRequested(true);
        }}
        topBar={
          hasOverlay
            ? undefined
            : {
                ...withoutHeadingAction(coachTopBar(coachTab, onCreateTraining, () => setHeadingRequest((n) => n + 1)), !headingActionVisible),
                unreadNotifications,
                onOpenNotifications: () => openTopOverlay("notifications"),
                onOpenFinance: trainerBalance ? () => openTopOverlay("finance") : undefined,
                search: searchConfig,
              }
        }
      >
        {blogContent ?? overlayContent ?? (
          <CoachTabContent
            key={tabResetKey}
            initialCoachUserId={marketplaceCoachId}
            marketplaceStart={marketplaceStart}
            tab={coachTab}
            token={token}
            userId={myUserId ?? ""}
            onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
            onCreateTraining={onCreateTraining}
            onOpenNotifications={() => setOverlay({ kind: "notifications" })}
            unreadNotifications={unreadNotifications}
            startProfileInSettings={profileSettingsRequested}
            onProfileSettingsOpened={clearProfileSettingsRequest}
            headingRequest={headingRequest}
          />
        )}
      </AppShell>
      </HeadingActionVisibility.Provider>
    );
  }

  return (
    <AppShell
      navItems={PLAYER_NAV_ITEMS}
      activeTab={blogPath ? "blog" : playerTab}
      onChangeTab={(tab) => {
        if (tab === "blog") {
          openBlog();
          return;
        }
        leaveBlog();
        setOverlay(null);
        setMarketplaceCoachId(null);
        setMarketplaceStart(null);
        if (tab === playerTab) setTabResetKey((key) => key + 1);
        setPlayerTab(tab);
      }}
      hasOverlay={hasOverlay}
      hidePageHeading={!!blogPath}
      sideUser={sideUser}
      onOpenAdmin={openAdmin}
      onOpenProfile={() => {
        leaveBlog();
        setOverlay(null);
        setPlayerTab("profile");
      }}
      onOpenSettings={() => {
        leaveBlog();
        setOverlay(null);
        setPlayerTab("profile");
        setProfileSettingsRequested(true);
      }}
      topBar={
        hasOverlay
          ? undefined
          : {
              ...playerTopBar(playerTab, onCreateTraining),
              unreadNotifications,
              onOpenNotifications: () => openTopOverlay("notifications"),
              search: searchConfig,
            }
      }
    >
      {blogContent ?? overlayContent ?? (
        <Fragment key={tabResetKey}>
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
          {playerTab === "calendar" && (
            <CalendarScreen
              token={token}
              onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
              onCreateTraining={() => setOverlay({ kind: "training-create" })}
            />
          )}
          {playerTab === "coaches" && (
            <CoachMarketplaceScreen
              key={`${marketplaceCoachId ?? "list"}|${marketplaceStart?.listingId ?? ""}|${marketplaceStart?.bookListingId ?? ""}`}
              token={token}
              initialCoachUserId={marketplaceCoachId}
              initialListingId={marketplaceStart?.listingId ?? null}
              initialBookListingId={marketplaceStart?.bookListingId ?? null}
              myUserId={myUserId}
              canFavorite
            />
          )}
          {playerTab === "profile" && (
            <ProfileScreen
              token={token}
              onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
              onOpenNotifications={() => setOverlay({ kind: "notifications" })}
              unreadNotifications={unreadNotifications}
              startInSettings={profileSettingsRequested}
              onSettingsOpened={clearProfileSettingsRequest}
            />
          )}
        </Fragment>
      )}
    </AppShell>
  );
}

export function Workspace({ token, blogPath = null }: { token: string; blogPath?: string | null }) {
  const [inviteToken, setInviteToken] = useState<string | null>(readInviteToken);
  const [deepLink] = useState<DeepLink | null>(readNotificationDeepLink);
  const [marketplaceIntent] = useState<MarketplaceIntent | null>(readMarketplaceIntent);

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

  // Same for ?coach=&listing=&book= (a shared catalogue link, or the booking a
  // guest was in the middle of): read once, then the address bar is cleaned.
  useEffect(() => {
    if (!marketplaceIntent) return;
    const url = new URL(window.location.href);
    for (const key of ["coach", "listing", "book"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ProfileProvider token={token}>
      {inviteToken ? (
        <InviteAcceptScreenGate token={token} inviteToken={inviteToken} onDone={clearInvite} />
      ) : (
        <MainContent blogPath={blogPath} token={token} deepLink={deepLink} initialTeamId={teamToOpen} marketplaceIntent={marketplaceIntent} />
      )}
    </ProfileProvider>
  );
}

// Invite acceptance waits for the profile request to finish first, so joining
// a team as a coach/player happens once the app knows who the person is.
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
