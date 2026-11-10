import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

/** A number with its caption. */
export function StatTile({ value, label }: { value: string | number; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
}

/** Tiles laid out in a wrapping grid, two per row on a phone. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 2 },
});
