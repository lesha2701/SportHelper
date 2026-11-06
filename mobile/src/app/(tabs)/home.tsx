import { router, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { listCoachPendingBookings } from "@/api/bookings";
import { getCalendar } from "@/api/calendar";
import { getProgressAnalysis } from "@/api/ai";
import { getPlayerStats, getTeamStats } from "@/api/stats";
import { listMyTasks, listTeamTasks } from "@/api/tasks";
import { listMyTeams } from "@/api/teams";
import { useAuth } from "@/auth/AuthProvider";
import { eventIcon, homeStyles, BigStat, NextEventHero, QuickAction, WeekStrip } from "@/home/HomeParts";
import { useFeatures } from "@/lib/useFeatures";
import { useLoad } from "@/lib/useLoad";
import { useUnread } from "@/notifications/UnreadProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { addDays, formatDayTitle, shortTime, startOfWeekIso, todayIso } from "@/shared/lib/dates";
import type { CalendarEvent } from "@/shared/types/calendar";
import type { ProfileMe } from "@/shared/types/profile";
import { formatRate } from "@/shared/types/stats";
import type { Team } from "@/shared/types/team";
import { AiText } from "@/ui/AiText";
import { BottomSheet } from "@/ui/BottomSheet";
import { Card } from "@/ui/Card";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Mode = "player" | "coach";
type CreateKind = "training" | "task" | "match";

function currentMode(profile: ProfileMe, preferred: Mode | null): Mode {
  if (profile.activeMode) return profile.activeMode;
  if (profile.player && !profile.coach) return "player";
  if (profile.coach && !profile.player) return "coach";
  return preferred ?? "player";
}

function openEvent(event: CalendarEvent) {
  if (event.type === "training") router.push({ pathname: "/training/[id]", params: { id: event.id } });
  else if (event.type === "match") router.push({ pathname: "/match/[id]", params: { id: event.id } });
  else router.push({ pathname: "/task/[id]", params: { id: event.id } });
}

const pending = (e: CalendarEvent) => e.status !== "completed" && e.status !== "cancelled";

/** The first thing after opening the app: the next event, a few numbers, this week day by day, quick actions and
 * what needs attention. */
export default function HomeScreen() {
  const { user } = useAuth();
  const { state } = useProfile();
  const features = useFeatures();
  const unread = useUnread();
  const mode = state.status === "ready" ? currentMode(state.data, user?.preferredRole ?? null) : "player";
  const today = todayIso();
  const monday = startOfWeekIso(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const data = useLoad(async () => {
    const events = await getCalendar(monday, addDays(today, 30)).catch(() => [] as CalendarEvent[]);
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const next =
      [...events]
        .filter((e) => pending(e) && (e.date > today || (e.date === today && (e.time ?? "99:99").slice(0, 5) >= nowTime)))
        .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))[0] ?? null;

    if (mode === "player") {
      const [stats, tasks] = await Promise.all([getPlayerStats(user!.id).catch(() => null), listMyTasks().catch(() => [])]);
      const openTasks = tasks.filter((t) => ["assigned", "viewed", "in_progress", "needs_revision"].includes(t.assignment.status)).length;
      return { events, next, stats, openTasks, teams: [] as Team[], requests: 0, toReview: 0, teamStats: null };
    }
    const [teams, requests] = await Promise.all([listMyTeams().catch(() => [] as Team[]), listCoachPendingBookings().catch(() => [])]);
    const staffTeams = teams.filter((t) => t.myRole === "head_coach" || t.myRole === "assistant_coach");
    const tasks = (await Promise.all(staffTeams.map((t) => listTeamTasks(t.id).catch(() => [])))).flat();
    const toReview = tasks.reduce((n, t) => n + t.assignments.filter((a) => a.status === "submitted").length, 0);
    // The website's coach panel: load, who needs attention and recent results of the (first) team.
    const teamStats = staffTeams[0] ? await getTeamStats(staffTeams[0].id).catch(() => null) : null;
    return { events, next, stats: null, openTasks: 0, teams: staffTeams, requests: requests.length, toReview, teamStats };
  }, [mode, user?.id]);

  if (state.status !== "ready") return null;
  const d = data.data;
  const weekEvents = (d?.events ?? []).filter((e) => e.date >= monday && e.date <= addDays(monday, 6));
  const busyDays = new Set(weekEvents.map((e) => e.date));
  const dayEvents = weekEvents.filter((e) => e.date === selectedDay).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  /** Training / task / match: a coach picks the team first when there is more than one. */
  function create(kind: CreateKind) {
    if (mode === "player") {
      router.push("/training/new");
      return;
    }
    const teams = d?.teams ?? [];
    if (teams.length === 1) go(kind, teams[0]!.id);
    else if (teams.length === 0) router.push("/teams");
    else setCreating(kind);
  }
  function go(kind: CreateKind, teamId: string) {
    setCreating(null);
    const path: Href =
      kind === "training"
        ? { pathname: "/training/new", params: { teamId } }
        : kind === "task"
          ? { pathname: "/task/new", params: { teamId } }
          : { pathname: "/match/new", params: { teamId } };
    router.push(path);
  }

  const attention = [
    unread.count > 0 ? { icon: "notifications-outline" as const, title: "Новые уведомления", badge: unread.count, to: "/notifications" as Href } : null,
    d && d.requests > 0 ? { icon: "person-add-outline" as const, title: "Заявки на запись", badge: d.requests, to: "/bookings" as Href } : null,
    d && d.toReview > 0 ? { icon: "checkmark-done-outline" as const, title: "Отчёты ждут проверки", badge: d.toReview, to: "/my-tasks" as Href } : null,
    d && d.openTasks > 0 ? { icon: "clipboard-outline" as const, title: "Задания к выполнению", badge: d.openTasks, to: "/my-tasks" as Href } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <Screen
      header
      onRefresh={() => {
        data.reload();
        unread.refresh();
      }}
      refreshing={data.loading && !!d}
    >
      <View style={{ gap: 2 }}>
        <Text variant="caption" muted>
          {mode === "coach" ? "Тренерская панель" : "Твой прогресс"}
        </Text>
        <Text variant="title">Привет, {user?.firstName}!</Text>
      </View>

      <NextEventHero
        event={d?.next ?? null}
        onPress={() => (d?.next ? openEvent(d.next) : router.push("/calendar"))}
        emptyText={mode === "coach" ? "Создайте тренировку или матч для команды." : "Создайте личную тренировку или найдите тренера."}
      />

      {mode === "player" && d?.stats ? (
        <View style={homeStyles.grid2}>
          <BigStat value={formatRate(d.stats.attendanceRate)} label="Посещаемость" />
          <BigStat value={d.stats.activityStreak} label="Серия посещений" />
          <BigStat value={d.stats.tasksCompleted} label="Заданий выполнено" />
          <BigStat value={d.stats.tasksOverdue} label="Просрочено" />
        </View>
      ) : null}
      {mode === "coach" && d ? (
        <View style={homeStyles.grid2}>
          <BigStat value={d.teams.length} label="Команд" />
          <BigStat value={weekEvents.filter(pending).length} label="Событий на неделе" />
          <BigStat value={d.toReview} label="Отчётов на проверку" />
          <BigStat value={d.requests} label="Заявок на запись" />
        </View>
      ) : null}

      <View style={homeStyles.quickRow}>
        <QuickAction icon="barbell-outline" label="Тренировка" onPress={() => create("training")} />
        {mode === "coach" ? (
          <>
            <QuickAction icon="clipboard-outline" label="Задание" onPress={() => create("task")} />
            <QuickAction icon="football-outline" label="Матч" onPress={() => create("match")} />
          </>
        ) : (
          <>
            <QuickAction icon="clipboard-outline" label="Задания" onPress={() => router.push("/my-tasks")} />
            <QuickAction icon="stats-chart-outline" label="Статистика" onPress={() => router.push("/stats")} />
          </>
        )}
      </View>

      {attention.length > 0 ? (
        <Card>
          <Text variant="heading">Требует внимания</Text>
          {attention.map((a) => (
            <ListRow key={a.title} icon={a.icon} title={a.title} badge={a.badge} onPress={() => router.push(a.to)} />
          ))}
        </Card>
      ) : null}

      {mode === "coach" && d?.teamStats ? (
        <>
          <Card>
            <Text variant="heading">Нагрузка команды{d.teams.length > 1 ? ` · ${d.teams[0]!.name}` : ""}</Text>
            <View style={homeStyles.grid2}>
              <BigStat value={formatRate(d.teamStats.attendanceRate)} label="Посещаемость" />
              <BigStat value={d.teamStats.trainingsCompleted} label="Тренировок проведено" />
              <BigStat value={`${d.teamStats.tasksCompleted}/${d.teamStats.tasksTotal}`} label="Заданий выполнено" />
              <BigStat value={d.teamStats.avgWellbeing ?? "—"} label="Самочувствие" />
            </View>
            <Text variant="caption" muted>
              Матчи: {d.teamStats.matchesWon}-{d.teamStats.matchesDrawn}-{d.teamStats.matchesLost} (победы-ничьи-поражения)
            </Text>
          </Card>
          <Card>
            <Text variant="heading">Игроки: нужно внимание</Text>
            {[...d.teamStats.frequentAbsencePlayers, ...d.teamStats.lowActivityPlayers]
              .filter((p, i, all) => all.findIndex((x) => x.userId === p.userId) === i)
              .slice(0, 4)
              .map((p) => (
                <ListRow
                  key={p.userId}
                  icon="alert-circle-outline"
                  title={[p.firstName, p.lastName].filter(Boolean).join(" ")}
                  subtitle={`Пропусков: ${p.absentCount} · посещаемость ${formatRate(p.attendanceRate)}`}
                  onPress={() => router.push({ pathname: "/team/[id]/member/[userId]", params: { id: d.teams[0]!.id, userId: p.userId } })}
                />
              ))}
            {d.teamStats.frequentAbsencePlayers.length + d.teamStats.lowActivityPlayers.length === 0 ? <Text muted>Все в порядке.</Text> : null}
          </Card>
        </>
      ) : null}

      {mode === "player" && d?.stats ? (
        <>
          <AiText title="Рекомендации ИИ" heading="Рекомендации ИИ" load={getProgressAnalysis} />
          <Card>
            <Text variant="heading">Последние матчи</Text>
            {d.stats.matchesHistory.length === 0 ? <Text muted>Пока нет сыгранных матчей.</Text> : null}
            {d.stats.matchesHistory.slice(0, 3).map((m, i) => (
              <Text key={i}>
                {m.opponentName} · {m.ourScore ?? "–"}:{m.opponentScore ?? "–"} · {formatDayTitle(m.matchDate)}
              </Text>
            ))}
          </Card>
        </>
      ) : null}

      <Card>
        <Text variant="heading">Эта неделя</Text>
        <WeekStrip monday={monday} selected={selectedDay} busyDays={busyDays} onSelect={setSelectedDay} />
        <Text variant="label" muted>
          {selectedDay === today ? "Сегодня, " : ""}
          {formatDayTitle(selectedDay)}
        </Text>
        {dayEvents.length === 0 ? <Text muted>В этот день ничего нет.</Text> : null}
        {dayEvents.map((e) => (
          <ListRow
            key={`${e.type}-${e.id}`}
            icon={eventIcon(e.type)}
            title={e.title}
            subtitle={[shortTime(e.time), e.teamName, e.status === "completed" ? "проведено" : null].filter(Boolean).join(" · ")}
            onPress={() => openEvent(e)}
          />
        ))}
        <ListRow icon="calendar-outline" title="Открыть календарь" onPress={() => router.push("/calendar")} />
      </Card>

      <Card>
        <Text variant="heading">Ещё</Text>
        <ListRow icon="search-outline" title="Поиск" onPress={() => router.push("/search")} />
        <ListRow icon="bookmark-outline" title={mode === "coach" ? "Записи ко мне" : "Мои записи"} onPress={() => router.push("/bookings")} />
        {mode === "coach" && features.trainerBalance ? <ListRow icon="wallet-outline" title="Финансы" onPress={() => router.push("/finance")} /> : null}
      </Card>

      <BottomSheet visible={creating !== null} title="Для какой команды?" onClose={() => setCreating(null)}>
        {(d?.teams ?? []).map((t) => (
          <ListRow key={t.id} icon="people-outline" title={t.name} subtitle={t.sport} onPress={() => creating && go(creating, t.id)} />
        ))}
      </BottomSheet>
    </Screen>
  );
}
