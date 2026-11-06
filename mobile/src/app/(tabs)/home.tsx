import { router } from "expo-router";
import { listCoachPendingBookings } from "@/api/bookings";
import { getCalendar } from "@/api/calendar";
import { listNotifications } from "@/api/notifications";
import { listMyTasks } from "@/api/tasks";
import { useAuth } from "@/auth/AuthProvider";
import { useFeatures } from "@/lib/useFeatures";
import { useLoad } from "@/lib/useLoad";
import { useProfile } from "@/profile/ProfileProvider";
import { addDays, formatDayTitle, shortTime, todayIso } from "@/shared/lib/dates";
import { years } from "@/shared/lib/plural";
import type { CalendarEvent } from "@/shared/types/calendar";
import { SKILL_LEVEL_LABELS, type ProfileMe } from "@/shared/types/profile";
import { Card } from "@/ui/Card";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Mode = "player" | "coach";

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

/** What needs the person's attention, the next few events and the sections: the page to open the app on. */
export default function HomeScreen() {
  const { user } = useAuth();
  const { state } = useProfile();
  const features = useFeatures();
  const mode = state.status === "ready" ? currentMode(state.data, user?.preferredRole ?? null) : "player";

  const summary = useLoad(async () => {
    const today = todayIso();
    const [events, notifications, pending, tasks] = await Promise.all([
      getCalendar(today, addDays(today, 7)).catch(() => [] as CalendarEvent[]),
      listNotifications().catch(() => []),
      mode === "coach" ? listCoachPendingBookings().catch(() => []) : Promise.resolve([]),
      mode === "player" ? listMyTasks().catch(() => []) : Promise.resolve([]),
    ]);
    const upcoming = events
      .filter((e) => e.status !== "completed" && e.status !== "cancelled")
      .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
      .slice(0, 4);
    const unread = notifications.filter((n) => !n.readAt).length;
    const openTasks = tasks.filter((t) => ["assigned", "viewed", "in_progress", "needs_revision"].includes(t.assignment.status)).length;
    return { upcoming, unread, pending: pending.length, openTasks };
  }, [mode]);

  if (state.status !== "ready") return null;
  const player = state.data.player;
  const coach = state.data.coach;
  const s = summary.data;

  return (
    <Screen header onRefresh={summary.reload} refreshing={summary.loading && !!summary.data}>
      <Text variant="title">Привет, {user?.firstName}!</Text>

      {s && (s.unread > 0 || s.pending > 0 || s.openTasks > 0) ? (
        <Card>
          <Text variant="heading">Требует внимания</Text>
          {s.unread > 0 ? <ListRow icon="notifications-outline" title="Новые уведомления" badge={s.unread} onPress={() => router.push("/notifications")} /> : null}
          {s.pending > 0 ? <ListRow icon="person-add-outline" title="Заявки на запись" subtitle="Ждут вашего ответа" badge={s.pending} onPress={() => router.push("/bookings")} /> : null}
          {s.openTasks > 0 ? <ListRow icon="clipboard-outline" title="Задания к выполнению" badge={s.openTasks} onPress={() => router.push("/my-tasks")} /> : null}
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">Ближайшие 7 дней</Text>
        {summary.loading && !s ? <Text muted>Загружаем…</Text> : null}
        {s && s.upcoming.length === 0 ? (
          <Text muted>{mode === "coach" ? "Событий пока нет. Создайте тренировку в команде." : "Событий пока нет. Загляните в календарь или создайте личную тренировку."}</Text>
        ) : null}
        {s?.upcoming.map((e) => (
          <ListRow
            key={`${e.type}-${e.id}`}
            icon={e.type === "match" ? "football-outline" : e.type === "task_deadline" ? "clipboard-outline" : "barbell-outline"}
            title={e.title}
            subtitle={[formatDayTitle(e.date), shortTime(e.time), e.teamName].filter(Boolean).join(" · ")}
            onPress={() => openEvent(e)}
          />
        ))}
        <ListRow icon="calendar-outline" title="Весь календарь" onPress={() => router.push("/calendar")} />
      </Card>

      <Card>
        <Text variant="heading">Разделы</Text>
        {s && s.unread === 0 ? <ListRow icon="notifications-outline" title="Уведомления" onPress={() => router.push("/notifications")} /> : null}
        <ListRow icon="search-outline" title="Поиск" onPress={() => router.push("/search")} />
        {mode === "player" ? <ListRow icon="stats-chart-outline" title="Моя статистика" onPress={() => router.push("/stats")} /> : null}
        {mode === "player" ? <ListRow icon="compass-outline" title="Найти тренера" subtitle="Каталог предложений" onPress={() => router.push("/coaches")} /> : null}
        <ListRow icon="bookmark-outline" title={mode === "coach" ? "Записи ко мне" : "Мои записи"} onPress={() => router.push("/bookings")} />
        {mode === "coach" ? <ListRow icon="library-outline" title="Библиотека" subtitle="Упражнения, планы, шаблоны" onPress={() => router.push("/library")} /> : null}
        {mode === "coach" ? <ListRow icon="pricetag-outline" title="Мои предложения" subtitle="Что вы продаёте клиентам" onPress={() => router.push("/my-listings")} /> : null}
        {mode === "coach" && features.trainerBalance ? <ListRow icon="wallet-outline" title="Финансы" onPress={() => router.push("/finance")} /> : null}
      </Card>

      {mode === "player" && player ? (
        <Card onPress={() => router.push("/profile")}>
          <Text variant="caption" muted>
            Мой профиль
          </Text>
          <Text variant="heading">{player.sport}</Text>
          <Text muted>{[player.position, player.level ? SKILL_LEVEL_LABELS[player.level] : null].filter(Boolean).join(" · ") || "Уровень не указан"}</Text>
        </Card>
      ) : null}
      {mode === "coach" && coach ? (
        <Card onPress={() => router.push("/profile")}>
          <Text variant="caption" muted>
            Мой профиль
          </Text>
          <Text variant="heading">{coach.sport}</Text>
          <Text muted>
            {[coach.specialization, coach.experienceYears != null ? `${years(coach.experienceYears)} опыта` : null].filter(Boolean).join(" · ") || "Специализация не указана"}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
