import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatDayTitle, parseIso, toIso } from "@/shared/lib/dates";
import { useTheme } from "@/theme/ThemeProvider";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const firstOfMonth = (date: string) => date.slice(0, 7) + "-01";

export function CalendarDatePicker({ earliest, latest, selected, onSelect }: {
  earliest: string;
  latest: string;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(firstOfMonth(earliest));
  const first = parseIso(month);
  const year = first.getFullYear();
  const index = first.getMonth();
  const prev = toIso(new Date(year, index - 1, 1));
  const next = toIso(new Date(year, index + 1, 1));
  const leading = (first.getDay() + 6) % 7;
  const dayCount = new Date(year, index + 1, 0).getDate();

  return (
    <>
      <Button title="Выбрать в календаре" variant="secondary" onPress={() => {
        setMonth(firstOfMonth(selected && selected >= earliest && selected <= latest ? selected : earliest));
        setOpen(true);
      }} />
      <BottomSheet visible={open} title="Выберите дату" onClose={() => setOpen(false)}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий месяц" disabled={prev < firstOfMonth(earliest)} onPress={() => setMonth(prev)} style={{ padding: 10 }}>
            <Ionicons name="chevron-back" size={22} color={prev < firstOfMonth(earliest) ? colors.textTertiary : colors.text} />
          </Pressable>
          <Text variant="label">{first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Следующий месяц" disabled={next > firstOfMonth(latest)} onPress={() => setMonth(next)} style={{ padding: 10 }}>
            <Ionicons name="chevron-forward" size={22} color={next > firstOfMonth(latest) ? colors.textTertiary : colors.text} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {WEEK.map((day) => <Text key={day} variant="caption" muted style={{ width: "14.28%", textAlign: "center" }}>{day}</Text>)}
          {Array.from({ length: leading }, (_, i) => <View key={i} style={{ width: "14.28%" }} />)}
          {Array.from({ length: dayCount }, (_, i) => {
            const day = toIso(new Date(year, index, i + 1));
            const disabled = day < earliest || day > latest;
            const active = day === selected;
            return (
              <Pressable key={day} accessibilityRole="button" accessibilityLabel={formatDayTitle(day)}
                accessibilityState={{ disabled, selected: active }} disabled={disabled}
                onPress={() => { setOpen(false); onSelect(day); }}
                style={{ width: "14.28%", minHeight: 44, justifyContent: "center", alignItems: "center", backgroundColor: active ? colors.primaryGlow : undefined }}>
                <Text variant="label" style={{ color: disabled ? colors.textTertiary : active ? colors.primary : colors.text }}>{i + 1}</Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}
