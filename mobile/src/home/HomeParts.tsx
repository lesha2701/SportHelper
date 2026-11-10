import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { addDays, parseIso, shortTime, todayIso } from "@/shared/lib/dates";
import type { CalendarEvent } from "@/shared/types/calendar";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Text } from "@/ui/Text";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function eventIcon(type: CalendarEvent["type"]): IconName {
  return type === "match" ? "football-outline" : type === "task_deadline" ? "clipboard-outline" : "barbell-outline";
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** "сегодня · 18:00", "завтра · 10:00", "12 ноя · 15:00". */
export function whenLabel(e: Pick<CalendarEvent, "date" | "time">): string {
  const today = todayIso();
  const day = e.date === today ? "сегодня" : e.date === addDays(today, 1) ? "завтра" : `${parseIso(e.date).getDate()} ${MONTHS[parseIso(e.date).getMonth()]}`;
  return [day, shortTime(e.time)].filter(Boolean).join(" · ");
}

/** The big card of the next event, the first thing on the home screen (as on the website). */
export function NextEventHero({ event, onPress, emptyText }: { event: CalendarEvent | null; onPress: () => void; emptyText: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.hero, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.9 : 1 }]}
    >
      {/* A soft red shape in the corner, in place of the website's wave. */}
      <View style={[styles.glow, { backgroundColor: colors.primaryGlow }]} />
      <View style={[styles.glowSmall, { backgroundColor: colors.primaryGlow }]} />
      {event ? (
        <>
          <View style={[styles.pill, { backgroundColor: colors.primary }]}>
            <Text style={styles.pillText}>{whenLabel(event)}</Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.text }]} numberOfLines={3}>
            {event.title}
          </Text>
          <Text muted>{event.teamName ?? "Ближайшее событие"}</Text>
          <View style={styles.heroFoot}>
            <Ionicons name={eventIcon(event.type)} size={22} color={colors.text} />
            <Text variant="label" style={{ color: colors.primary }}>
              Открыть ›
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.heroTitle, { color: colors.text }]}>Пока ничего не запланировано</Text>
          <Text muted>{emptyText}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A big red number with its caption (the website's stat tiles). */
export function BigStat({ value, label }: { value: string | number; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Monday to Sunday of the current week; a dot under the days that have something; tap a day to see it. */
export function WeekStrip({ monday, selected, busyDays, onSelect }: { monday: string; selected: string; busyDays: Set<string>; onSelect: (day: string) => void }) {
  const { colors } = useTheme();
  const today = todayIso();
  return (
    <View style={styles.week}>
      {WEEKDAYS.map((w, i) => {
        const day = addDays(monday, i);
        const active = day === selected;
        const isToday = day === today;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${w}, ${parseIso(day).getDate()}${busyDays.has(day) ? ", есть события" : ""}`}
            onPress={() => onSelect(day)}
            style={[styles.weekDay, { backgroundColor: active ? colors.primary : "transparent", borderColor: isToday && !active ? colors.primary : "transparent" }]}
          >
            <Text variant="caption" style={{ color: active ? colors.primaryText : colors.textSecondary }}>
              {w}
            </Text>
            <Text variant="label" style={{ fontSize: 16, color: active ? colors.primaryText : colors.text }}>
              {parseIso(day).getDate()}
            </Text>
            <View style={[styles.dot, { backgroundColor: busyDays.has(day) ? (active ? colors.primaryText : colors.primary) : "transparent" }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** A square quick action: icon in a tinted tile and a caption. */
export function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quick, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.quickIcon, { backgroundColor: colors.primaryGlow }]}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text variant="label" style={{ textAlign: "center" }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export const homeStyles = StyleSheet.create({
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickRow: { flexDirection: "row", gap: 10 },
});

const styles = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: radius.lg * 1.5, padding: 20, gap: 10, overflow: "hidden", minHeight: 190 },
  glow: { position: "absolute", width: 260, height: 260, borderRadius: 130, right: -90, top: -110, opacity: 0.9 },
  glowSmall: { position: "absolute", width: 140, height: 140, borderRadius: 70, right: 30, bottom: -90, opacity: 0.6 },
  pill: { alignSelf: "flex-start", borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 12 },
  pillText: { color: "#fff", fontFamily: fonts.display, fontSize: 13, letterSpacing: 0.5, textTransform: "uppercase" },
  heroTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, textTransform: "uppercase" },
  heroFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  stat: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  statLabel: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 14, textTransform: "uppercase", letterSpacing: 0.4 },
  week: { flexDirection: "row", justifyContent: "space-between" },
  weekDay: { width: 42, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, alignItems: "center", gap: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  quick: { flex: 1, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 6, alignItems: "center", gap: 8 },
  quickIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
