import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { eventIcon } from "@/home/HomeParts";
import { isOverdue } from "@/shared/lib/calendarView";
import { addDays, formatDayTitle, parseIso, shortTime, todayIso } from "@/shared/lib/dates";
import type { CalendarEvent, CalendarEventType } from "@/shared/types/calendar";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius, type Palette } from "@/theme/tokens";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";

const MATCH_BLUE = "#4c8dff";

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  training: "Тренировка",
  match: "Матч",
  task_deadline: "Дедлайн задания",
};

/** The website's colours of the three kinds of event: red trainings, blue matches, amber task deadlines. */
export function eventColors(type: CalendarEventType, colors: Palette): { fg: string; bg: string } {
  if (type === "match") return { fg: MATCH_BLUE, bg: "rgba(76,141,255,0.16)" };
  if (type === "task_deadline") return { fg: colors.warning, bg: colors.warningBg };
  return { fg: colors.primary, bg: colors.primaryGlow };
}

/** One line of a day card: coloured icon and time, the title and team, and a «Просрочена» mark. */
export function EventRow({ event, onPress }: { event: CalendarEvent; onPress: () => void }) {
  const { colors } = useTheme();
  const tint = eventColors(event.type, colors);
  const overdue = isOverdue(event, todayIso());
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceAlt : "transparent",
          borderLeftColor: tint.fg,
        },
      ]}
    >
      <View style={styles.rowTime}>
        <Ionicons name={eventIcon(event.type)} size={15} color={tint.fg} />
        <Text variant="label" style={{ color: tint.fg }}>
          {shortTime(event.time) || "—"}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {event.title}
        </Text>
        {event.teamName ? (
          <Text variant="caption" muted numberOfLines={1}>
            {event.teamName}
          </Text>
        ) : null}
      </View>
      {overdue ? (
        <View style={[styles.badge, { backgroundColor: colors.warningBg }]}>
          <Text variant="caption" style={{ color: colors.warning }}>
            Просрочена
          </Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

/** A day of the list: its title and its events. */
export function DayCard({ date, events, onOpen }: { date: string; events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const { colors } = useTheme();
  const today = date === todayIso();
  return (
    <Card style={{ gap: 6 }}>
      <Text style={[styles.dayTitle, { color: today ? colors.primary : colors.text }]}>
        {today ? "Сегодня · " : ""}
        {formatDayTitle(date)}
      </Text>
      {events.map((e) => (
        <EventRow key={`${e.type}-${e.id}`} event={e} onPress={() => onOpen(e)} />
      ))}
    </Card>
  );
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** The week on a phone: seven day chips with a coloured dot per kind of event; tap a day to open it. */
export function WeekDays({ monday, events, onSelect }: { monday: string; events: CalendarEvent[]; onSelect: (day: string) => void }) {
  const { colors } = useTheme();
  const today = todayIso();
  return (
    <Card style={styles.weekCard}>
      {WEEKDAYS.map((w, i) => {
        const day = addDays(monday, i);
        const kinds = [...new Set(events.filter((e) => e.date === day).map((e) => e.type))];
        const isToday = day === today;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityLabel={`${formatDayTitle(day)}${kinds.length ? ", есть события" : ""}`}
            onPress={() => onSelect(day)}
            style={({ pressed }) => [styles.weekDay, { backgroundColor: isToday ? colors.primary : pressed ? colors.surfaceAlt : "transparent" }]}
          >
            <Text variant="caption" style={{ color: isToday ? colors.primaryText : colors.textSecondary }}>
              {w}
            </Text>
            <Text variant="label" style={{ fontSize: 16, color: isToday ? colors.primaryText : colors.text }}>
              {parseIso(day).getDate()}
            </Text>
            <View style={styles.dots}>
              {kinds.map((k) => (
                <View key={k} style={[styles.dot, { backgroundColor: isToday ? colors.primaryText : eventColors(k, colors).fg }]} />
              ))}
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderRadius: radius.md,
  },
  rowTime: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 64 },
  badge: {
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  dayTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  weekCard: { flexDirection: "row", gap: 2, paddingHorizontal: 6, paddingVertical: 8 },
  weekDay: { flex: 1, minWidth: 0, paddingVertical: 6, borderRadius: radius.md, alignItems: "center", gap: 2 },
  dots: { flexDirection: "row", gap: 3, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
