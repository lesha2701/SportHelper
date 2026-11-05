import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Option<T extends string> {
  value: T;
  title: string;
  hint?: string;
}

interface Props<T extends string> {
  label?: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  /** "cards": one option per row with a hint; "chips": a wrapping set of short options. */
  layout?: "cards" | "chips";
  disabled?: boolean;
  /** For several choices at once: the selected values (then `value` is ignored). */
  selected?: T[];
}

export function Choice<T extends string>({ label, options, value, onChange, error, layout = "cards", disabled, selected }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {label ? (
        <Text variant="label" muted>
          {label}
        </Text>
      ) : null}
      <View style={layout === "chips" ? styles.chips : styles.cards}>
        {options.map((option) => {
          const active = selected ? selected.includes(option.value) : option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={[
                layout === "chips" ? styles.chip : styles.card,
                {
                  borderColor: active ? colors.primary : colors.borderStrong,
                  backgroundColor: active ? colors.primaryGlow : colors.surface,
                },
              ]}
            >
              <Text variant="label" style={active ? { color: colors.primary } : undefined}>
                {option.title}
              </Text>
              {option.hint && layout === "cards" ? (
                <Text variant="caption" muted>
                  {option.hint}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  cards: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 2 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
});
