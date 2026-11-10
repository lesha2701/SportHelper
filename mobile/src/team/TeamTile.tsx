import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** One section of a team as a tile: an icon in a tinted square, the name, a short line, and an optional count. */
export function TeamTile({
  icon,
  title,
  subtitle,
  badge,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  badge?: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: colors.primaryGlow }]}>
          <Ionicons name={icon} size={24} color={colors.primary} />
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text variant="caption" muted numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6, minHeight: 130 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  icon: { width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 11 },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22, textTransform: "uppercase", marginTop: 2 },
});
