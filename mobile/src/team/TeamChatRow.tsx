import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** The way into the team's chat, as in a messenger: a wide row right under the team's card, with the unread count. */
export function TeamChatRow({ teamId, members, unread }: { teamId: string; members: number; unread: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Чат команды, новых сообщений: ${unread}` : "Чат команды"}
      onPress={() => router.push({ pathname: "/chat/[kind]/[id]", params: { kind: "team", id: teamId } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.primaryGlow : colors.surface, borderColor: unread > 0 ? colors.primary : colors.border },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primary }]}>
        <Ionicons name="chatbubbles" size={22} color={colors.primaryText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" style={{ fontSize: 16 }}>
          Чат команды
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {unread > 0 ? `Новых сообщений: ${unread}` : `Участников: ${members}`}
        </Text>
      </View>
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
