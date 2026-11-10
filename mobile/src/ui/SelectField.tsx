import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { BottomSheet } from "./BottomSheet";
import { Text } from "./Text";

interface Option<T extends string> {
  value: T;
  title: string;
}

interface Props<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shown in the field when nothing (or the empty value) is chosen. */
  placeholder?: string;
}

/** A compact one-line choice that opens the full list in a bottom sheet: for long lists (sports) that would
 * otherwise fill the whole screen. */
export function SelectField<T extends string>({ label, options, value, onChange, placeholder }: Props<T>) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.title ?? placeholder ?? ""}`}
        onPress={() => setOpen(true)}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}
      >
        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, color: current ? colors.text : colors.textTertiary }} numberOfLines={1}>
          {current?.title ?? placeholder ?? "Выбрать"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={[styles.option, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryGlow : "transparent" }]}
            >
              <Text style={{ flex: 1, color: active ? colors.primary : colors.text, fontFamily: active ? fonts.bodySemi : fonts.body }}>{o.title}</Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  option: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" },
});
