import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Props {
  title: string;
  /** A second, muted line. */
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  /** A highlighted count on the right (unread, waiting). */
  badge?: number;
  onPress: () => void;
}

/** One tappable line of a menu or list: icon, text, optional count, and an arrow. */
export function ListRow({ title, subtitle, icon, badge, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border }]}
    >
      {icon ? <Ionicons name={icon} size={22} color={colors.primary} /> : null}
      <View style={styles.text}>
        <Text variant="label" style={{ fontSize: 15 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text variant="caption" style={{ color: colors.primaryText, fontWeight: "700" }}>
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: radius.md },
  text: { flex: 1, gap: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
});
