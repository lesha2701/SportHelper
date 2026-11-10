import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getCalendar } from "@/api/calendar";
import { DayCard, WeekDays } from "@/calendar/CalendarParts";
import { useLoad } from "@/lib/useLoad";
import { chronological, groupByDay, listRange, upcomingFirst } from "@/shared/lib/calendarView";
import { addDays, formatDayTitle, parseIso, startOfWeekIso, todayIso } from "@/shared/lib/dates";
import type { CalendarEvent } from "@/shared/types/calendar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Mode = "week" | "day";

function open(event: CalendarEvent) {
  if (event.type === "training") router.push({ pathname: "/training/[id]", params: { id: event.id } });
  else if (event.type === "match") router.push({ pathname: "/match/[id]", params: { id: event.id } });
  else router.push({ pathname: "/task/[id]", params: { id: event.id } });
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const short = (iso: string) => `${parseIso(iso).getDate()} ${MONTHS[parseIso(iso).getMonth()]}`;

const TABS: { value: Mode; title: string }[] = [
  { value: "week", title: "Неделя" },
  { value: "day", title: "День" },
];

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

/** The calendar: the week (a strip of days over every event, upcoming first, past ones flagged when nobody closed them) or one day. */
export default function CalendarScreen() {
  const { colors } = useTheme();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(today);
  const monday = startOfWeekIso(anchor);
  // The week tab lists everything around the shown week: two weeks back and two months ahead.
  const range = mode === "day" ? { from: anchor, to: anchor } : listRange(monday);
  const events = useLoad(() => getCalendar(range.from, range.to), [range.from, range.to]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setAnchor(today);
  };

  let body: React.ReactNode;
  if (events.loading && !events.data) body = <LoadingView />;
  else if (events.error && !events.data) body = <ErrorView message={events.error} onRetry={events.reload} />;
  else {
    const all = events.data ?? [];
    const sorted = mode === "week" ? upcomingFirst(all, today) : chronological(all);
    body = (
      <>
        {mode === "week" ? (
          <WeekDays
            monday={monday}
            events={all.filter((e) => e.date >= monday && e.date <= addDays(monday, 6))}
            onSelect={(day) => {
              setMode("day");
              setAnchor(day);
            }}
          />
        ) : null}
        {sorted.length === 0 ? (
          <>
            <EmptyView
              title={mode === "day" ? "В этот день ничего нет" : "Пока ничего нет"}
              hint="Здесь появятся тренировки, матчи и дедлайны заданий."
            />
            <Button title="Запланировать тренировку" onPress={() => router.push("/training/new")} />
          </>
        ) : (
          groupByDay(sorted).map(([date, list], i, groups) => (
            <View key={date} style={{ gap: 10 }}>
              {mode === "week" && date < today && (i === 0 || groups[i - 1]![0] >= today) ? (
                <Text variant="label" muted style={{ textTransform: "uppercase" }}>
                  Прошедшие
                </Text>
              ) : null}
              <DayCard date={date} events={list} onOpen={open} />
            </View>
          ))
        )}
      </>
    );
  }

  return (
    <Screen header onRefresh={events.reload} refreshing={events.loading && !!events.data}>
      <Button title="+ Добавить тренировку" variant="secondary" onPress={() => router.push("/training/new")} />
      <View style={[styles.tabs, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = tab.value === mode;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => switchMode(tab.value)}
              style={[styles.tab, active ? { backgroundColor: colors.primary } : null]}
            >
              <Text variant="label" style={{ fontSize: 13, color: active ? colors.primaryText : colors.textSecondary }}>
                {tab.title}
              </Text>
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

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 2 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 10 },
  pager: { flexDirection: "row", alignItems: "center", gap: 10 },
  arrow: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
