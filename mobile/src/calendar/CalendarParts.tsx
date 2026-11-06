import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { eventIcon } from "@/home/HomeParts";
import { WEEK_FIRST_HOUR, WEEK_LAST_HOUR, isOverdue, weekRowOffset } from "@/shared/lib/calendarView";
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
const ROW = 52;
const GUTTER = 40;

/** The website's week: days across, hours 08–20 down, events as coloured blocks; scrolls fits the phone's width. */
export function WeekGrid({ monday, events, onOpen }: { monday: string; events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const { colors } = useTheme();
  const today = todayIso();
  const days = WEEKDAYS.map((_, i) => addDays(monday, i));
  const hours = Array.from({ length: WEEK_LAST_HOUR - WEEK_FIRST_HOUR + 1 }, (_, i) => `${String(WEEK_FIRST_HOUR + i).padStart(2, "0")}:00`);
  const of = (day: string) => events.filter((e) => e.date === day);
  const anyUntimed = days.some((d) => of(d).some((e) => !e.time));

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <View>
        <View style={[styles.weekHead, { borderBottomColor: colors.border }]}>
          <View style={{ width: GUTTER }} />
          {days.map((d, i) => (
            <View key={d} style={styles.headCell}>
              <Text variant="caption" muted>
                {WEEKDAYS[i]}
              </Text>
              <View style={[styles.headNum, d === today ? { backgroundColor: colors.primary } : null]}>
                <Text
                  variant="label"
                  style={{
                    color: d === today ? colors.primaryText : colors.text,
                  }}
                >
                  {parseIso(d).getDate()}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {anyUntimed ? (
          <View style={[styles.weekHead, { borderBottomColor: colors.border }]}>
            <View style={{ width: GUTTER }} />
            {days.map((d) => (
              <View key={d} style={[styles.untimedCell]}>
                {of(d)
                  .filter((e) => !e.time)
                  .map((e) => {
                    const tint = eventColors(e.type, colors);
                    return (
                      <Pressable
                        key={`${e.type}-${e.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={e.title}
                        onPress={() => onOpen(e)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: tint.bg,
                            borderLeftColor: tint.fg,
                          },
                        ]}
                      >
                        <Text variant="caption" numberOfLines={1}>
                          {e.title}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            ))}
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            height: (hours.length - 1) * ROW + 12,
          }}
        >
          <View style={{ width: GUTTER }}>
            {hours.map((h, i) => (
              <Text key={h} variant="caption" muted style={[styles.hour, { top: i * ROW }]}>
                {h}
              </Text>
            ))}
          </View>
          {days.map((d) => (
            <View
              key={d}
              style={[
                styles.dayCol,
                {
                  borderLeftColor: colors.border,
                  backgroundColor: d === today ? colors.surfaceAlt : "transparent",
                },
              ]}
            >
              {hours.slice(1).map((h, i) => (
                <View key={h} style={[styles.hourLine, { top: (i + 1) * ROW + 6, backgroundColor: colors.border }]} />
              ))}
              {of(d)
                .filter((e) => e.time)
                .map((e) => {
                  const tint = eventColors(e.type, colors);
                  return (
                    <Pressable
                      key={`${e.type}-${e.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${shortTime(e.time)} ${e.title}`}
                      onPress={() => onOpen(e)}
                      style={[
                        styles.block,
                        {
                          top: weekRowOffset(e.time!) * ROW + 6,
                          height: ROW - 4,
                          backgroundColor: tint.bg,
                          borderLeftColor: tint.fg,
                        },
                      ]}
                    >
                      <Text style={[styles.blockTime, { color: tint.fg }]}>{shortTime(e.time)}</Text>
                      <Text style={[styles.blockTitle, { color: colors.text }]} numberOfLines={2}>
                        {e.title}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/** «Обозначения»: what each colour means. */
export function Legend() {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: 8 }}>
      <Text variant="heading">Обозначения</Text>
      {(Object.keys(EVENT_TYPE_LABELS) as CalendarEventType[]).map((type) => (
        <View key={type} style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: eventColors(type, colors).fg }]} />
          <Text>{EVENT_TYPE_LABELS[type]}</Text>
        </View>
      ))}
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
  weekHead: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 8 },
  headCell: { flex: 1, alignItems: "center", gap: 2 },
  headNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  untimedCell: { flex: 1, minWidth: 0, paddingHorizontal: 2, gap: 3 },
  chip: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  hour: { position: "absolute", left: 4, fontSize: 10 },
  dayCol: { flex: 1, minWidth: 0, borderLeftWidth: 1 },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  block: {
    position: "absolute",
    left: 2,
    right: 2,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 3,
    overflow: "hidden",
  },
  blockTime: { fontFamily: fonts.display, fontSize: 11, lineHeight: 13 },
  blockTitle: { fontFamily: fonts.bodyBold, fontSize: 9, lineHeight: 11 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
});
