import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  children: React.ReactNode;
}

/** A tick box with a label (which may hold links). Only the box toggles, so taps on links never tick it. */
export function Checkbox({ checked, onChange, error, children }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          hitSlop={8}
          onPress={() => onChange(!checked)}
          style={[
            styles.box,
            { borderColor: error ? colors.danger : colors.borderStrong, backgroundColor: checked ? colors.primary : colors.surface },
          ]}
        >
          {checked ? <Text style={{ color: colors.primaryText, fontSize: 14, lineHeight: 16 }}>✓</Text> : null}
        </Pressable>
        <View style={styles.label}>{children}</View>
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
  wrap: { gap: 4 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  box: { width: 24, height: 24, borderWidth: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginTop: 1 },
  label: { flex: 1 },
});
