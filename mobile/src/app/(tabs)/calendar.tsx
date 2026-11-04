import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { getCalendar } from "@/api/calendar";
import { useLoad } from "@/lib/useLoad";
import { addDays, formatDayTitle, shortTime, startOfWeekIso, todayIso } from "@/shared/lib/dates";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "@/shared/types/calendar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Range = "week" | "month";

function open(event: CalendarEvent) {
  if (event.type === "training") router.push({ pathname: "/training/[id]", params: { id: event.id } });
  else if (event.type === "match") router.push({ pathname: "/match/[id]", params: { id: event.id } });
  else router.push({ pathname: "/task/[id]", params: { id: event.id } });
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>("week");
  const [from, setFrom] = useState(startOfWeekIso(todayIso()));
  const to = addDays(from, range === "week" ? 6 : 34);
  const events = useLoad(() => getCalendar(from, to), [from, to]);

  const shift = (direction: 1 | -1) => setFrom(addDays(from, direction * (range === "week" ? 7 : 28)));
  const switchRange = (next: Range) => {
    setRange(next);
    setFrom(startOfWeekIso(todayIso()));
  };

  const days = new Map<string, CalendarEvent[]>();
  for (const e of [...(events.data ?? [])].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))) {
    days.set(e.date, [...(days.get(e.date) ?? []), e]);
  }

  return (
    <Screen>
      <Text variant="title">Календарь</Text>
      <Choice
        layout="chips"
        options={[
          { value: "week", title: "Неделя" },
          { value: "month", title: "5 недель" },
        ]}
        value={range}
        onChange={switchRange}
      />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Button title="‹" variant="secondary" onPress={() => shift(-1)} style={{ minWidth: 56 }} />
        <Text variant="label" style={{ flex: 1, textAlign: "center" }}>
          {formatDayTitle(from)} — {formatDayTitle(to)}
        </Text>
        <Button title="›" variant="secondary" onPress={() => shift(1)} style={{ minWidth: 56 }} />
      </View>
      <Button title="Новая личная тренировка" variant="secondary" onPress={() => router.push("/training/new")} />

      {events.loading && !events.data ? <LoadingView /> : null}
      {events.error && !events.data ? <ErrorView message={events.error} onRetry={events.reload} /> : null}
      {events.data && days.size === 0 ? <Text muted>В этом периоде событий нет.</Text> : null}
      {[...days.entries()].map(([date, list]) => (
        <View key={date} style={{ gap: 8 }}>
          <Text variant="label" style={date === todayIso() ? { color: colors.primary } : undefined}>
            {date === todayIso() ? "Сегодня · " : ""}
            {formatDayTitle(date)}
          </Text>
          {list.map((e) => (
            <Card key={`${e.type}-${e.id}`} onPress={() => open(e)}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Ionicons name={CALENDAR_EVENT_ICONS[e.type] as "barbell-outline"} size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="label">{e.title}</Text>
                  <Text muted variant="caption">
                    {[shortTime(e.time), e.teamName].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      ))}
    </Screen>
  );
}
