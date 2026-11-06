import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnread } from "@/notifications/UnreadProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { Text } from "./Text";

/** The header of the main sections: the section's name on the left, the notifications bell (with the unread count)
 * on the right, as in every app the person already knows. */
export function TabHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { count } = useUnread();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `Уведомления, непрочитанных: ${count}` : "Уведомления"}
        hitSlop={10}
        onPress={() => router.push("/notifications")}
        style={({ pressed }) => [styles.bell, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.text} />
        {count > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
            <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, textTransform: "uppercase", flex: 1 },
  bell: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 10, lineHeight: 12 },
});
