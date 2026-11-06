import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getCalendar } from "@/api/calendar";
import { DayCard, Legend, WeekGrid } from "@/calendar/CalendarParts";
import { useLoad } from "@/lib/useLoad";
import { chronological, groupByDay, isOverdue, listRange, upcomingFirst } from "@/shared/lib/calendarView";
import { addDays, formatDayTitle, parseIso, startOfWeekIso, todayIso } from "@/shared/lib/dates";
import type { CalendarEvent } from "@/shared/types/calendar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Mode = "list" | "overdue" | "day" | "week";

function open(event: CalendarEvent) {
  if (event.type === "training") router.push({ pathname: "/training/[id]", params: { id: event.id } });
  else if (event.type === "match") router.push({ pathname: "/match/[id]", params: { id: event.id } });
  else router.push({ pathname: "/task/[id]", params: { id: event.id } });
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const short = (iso: string) => `${parseIso(iso).getDate()} ${MONTHS[parseIso(iso).getMonth()]}`;

function Pager({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  const { colors } = useTheme();
  const arrow = (icon: "chevron-back" | "chevron-forward", onPress: () => void, name: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      hitSlop={8}
      onPress={onPress}
      style={[styles.arrow, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={styles.pager}>
      {arrow("chevron-back", onPrev, "Назад")}
      <Text variant="label" style={{ flex: 1, textAlign: "center" }}>
        {label}
      </Text>
      {arrow("chevron-forward", onNext, "Вперёд")}
    </View>
  );
}

/** The calendar as on the website: a list (upcoming first), what is overdue, one day, or the week as a grid by hour. */
export default function CalendarScreen() {
  const { colors } = useTheme();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>("list");
  const [anchor, setAnchor] = useState(today);
  const range = listRange(today);
  // The wide range feeds the list, the «Просрочено» tab and its count, whatever tab is open.
  const wide = useLoad(() => getCalendar(range.from, range.to), [range.from, range.to]);
  const monday = startOfWeekIso(anchor);
  const narrowFrom = mode === "day" ? anchor : monday;
  const narrowTo = mode === "day" ? anchor : addDays(monday, 6);
  const narrow = useLoad(async () => (mode === "day" || mode === "week" ? getCalendar(narrowFrom, narrowTo) : []), [mode, narrowFrom, narrowTo]);

  const overdue = chronological((wide.data ?? []).filter((e) => isOverdue(e, today)));
  const current = mode === "list" || mode === "overdue" ? wide : narrow;
  const reload = () => {
    wide.reload();
    narrow.reload();
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setAnchor(today);
  };

  let body: React.ReactNode = null;
  if (current.loading && !current.data) body = <LoadingView />;
  else if (current.error && !current.data) body = <ErrorView message={current.error} onRetry={current.reload} />;
  else if (mode === "week") {
    body = (
      <>
        <WeekGrid monday={monday} events={narrow.data ?? []} onOpen={open} />
        <Card style={{ gap: 6 }}>
          <View style={styles.sideHead}>
            <Text variant="heading" style={{ flex: 1 }}>
              Просрочено
            </Text>
            {overdue.length > 0 ? (
              <View style={[styles.count, { backgroundColor: colors.warningBg }]}>
                <Text variant="label" style={{ color: colors.warning }}>
                  {overdue.length}
                </Text>
              </View>
            ) : null}
          </View>
          {overdue.length === 0 ? <Text muted>Всё по плану.</Text> : null}
          {overdue.slice(0, 4).map((e) => (
            <Pressable key={`${e.type}-${e.id}`} accessibilityRole="button" onPress={() => open(e)} style={[styles.overdueItem, { borderBottomColor: colors.border }]}>
              <Text variant="label">{e.title}</Text>
              <Text variant="caption" muted>
                {formatDayTitle(e.date)}
                {e.time ? ` · ${e.time.slice(0, 5)}` : ""}
              </Text>
            </Pressable>
          ))}
          {overdue.length > 4 ? <Button title="Показать все" variant="ghost" onPress={() => switchMode("overdue")} /> : null}
        </Card>
        <Legend />
      </>
    );
  } else {
    const events =
      mode === "overdue"
        ? overdue
        : mode === "list"
          ? upcomingFirst(
              (wide.data ?? []).filter((e) => !isOverdue(e, today)),
              today,
            )
          : chronological(narrow.data ?? []);
    body =
      events.length === 0 ? (
        <>
          <EmptyView
            title={mode === "overdue" ? "Просроченных нет" : mode === "day" ? "В этот день ничего нет" : "Пока ничего нет"}
            hint={mode === "overdue" ? "Все тренировки идут по плану." : "Здесь появятся тренировки, матчи и дедлайны заданий."}
          />
          {mode !== "overdue" ? <Button title="Запланировать тренировку" onPress={() => router.push("/training/new")} /> : null}
        </>
      ) : (
        groupByDay(events).map(([date, list], i, all) => (
          <View key={date} style={{ gap: 10 }}>
            {mode === "list" && date < today && (i === 0 || all[i - 1]![0] >= today) ? (
              <Text variant="label" muted style={{ textTransform: "uppercase" }}>
                Прошедшие
              </Text>
            ) : null}
            <DayCard date={date} events={list} onOpen={open} />
          </View>
        ))
      );
  }

  return (
    <Screen header onRefresh={reload} refreshing={current.loading && !!current.data}>
      <Button title="+ Добавить тренировку" variant="secondary" onPress={() => router.push("/training/new")} />
      <View style={[styles.tabs, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = tab.value === mode;
          const badge = tab.value === "overdue" && overdue.length > 0 ? overdue.length : 0;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => switchMode(tab.value)}
              style={[styles.tab, active ? { backgroundColor: colors.primary } : null]}
            >
              <Text
                variant="label"
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  color: active ? colors.primaryText : colors.textSecondary,
                }}
              >
                {tab.title}
              </Text>
              {badge ? (
                <View
                  style={[
                    styles.tabBadge,
                    {
                      backgroundColor: active ? colors.primaryText : colors.warning,
                    },
                  ]}
                >
                  <Text style={[styles.tabBadgeText, { color: active ? colors.primary : "#fff" }]}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {mode === "day" ? (
        <Pager
          label={`${anchor === today ? "Сегодня · " : ""}${formatDayTitle(anchor)}`}
          onPrev={() => setAnchor(addDays(anchor, -1))}
          onNext={() => setAnchor(addDays(anchor, 1))}
        />
      ) : null}
      {mode === "week" ? (
        <Pager label={`${short(monday)} — ${short(addDays(monday, 6))}`} onPrev={() => setAnchor(addDays(anchor, -7))} onNext={() => setAnchor(addDays(anchor, 7))} />
      ) : null}
      {body}
    </Screen>
  );
}

const TABS: { value: Mode; title: string }[] = [
  { value: "list", title: "Список" },
  { value: "overdue", title: "Просрочено" },
  { value: "day", title: "День" },
  { value: "week", title: "Неделя" },
];

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
    gap: 2,
  },
  tab: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  tabBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: { fontSize: 10, fontWeight: "700" },
  pager: { flexDirection: "row", alignItems: "center", gap: 10 },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sideHead: { flexDirection: "row", alignItems: "center" },
  count: {
    borderRadius: 12,
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: "center",
  },
  overdueItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
});
