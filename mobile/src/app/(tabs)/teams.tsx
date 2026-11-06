import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { listMyTeams } from "@/api/teams";
import { useAuth } from "@/auth/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { TEAM_ROLE_LABELS, type Team } from "@/shared/types/team";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

function Badge({ text, warning }: { text: string; warning?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: warning ? colors.warningBg : colors.surfaceAlt }]}>
      <Text variant="caption" style={{ color: warning ? colors.warning : colors.textSecondary, fontSize: 12 }}>
        {text}
      </Text>
    </View>
  );
}

/** A team card as on the website: logo, name, «Без тренера», sport · age · people, and my role. */
function TeamCard({ team }: { team: Team }) {
  const { colors } = useTheme();
  const staff = team.myRole === "head_coach" || team.myRole === "assistant_coach";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border, borderLeftColor: staff ? colors.primary : colors.border },
      ]}
    >
      <View style={styles.row}>
        <Avatar fileId={team.logoFileId} name={team.name} size={48} square />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {team.name}
            </Text>
            {team.status === "without_coach" ? <Badge text="Без тренера" warning /> : null}
          </View>
          <Text variant="caption" muted>
            {[team.sport, team.ageCategory, `${team.membersCount} чел.`].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
      {team.myRole ? (
        <View style={{ flexDirection: "row" }}>
          <Badge text={TEAM_ROLE_LABELS[team.myRole]} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function TeamsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const teams = useLoad(listMyTeams);
  const isCoach = user?.preferredRole === "coach" || user?.isAdmin;

  if (teams.loading && !teams.data) return <LoadingView />;
  if (teams.error && !teams.data) return <ErrorView message={teams.error} onRetry={teams.reload} />;
  const list = teams.data ?? [];

  return (
    <Screen header onRefresh={teams.reload} refreshing={teams.loading && !!teams.data}>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: colors.text }]}>Мои команды</Text>
        {isCoach ? (
          <Pressable accessibilityRole="button" onPress={() => router.push("/team/new")} style={[styles.add, { backgroundColor: colors.primary }]}>
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text variant="label" style={{ color: colors.primaryText }}>
              Создать
            </Text>
          </Pressable>
        ) : null}
      </View>

      {list.length === 0 ? (
        <Card style={{ alignItems: "center", paddingVertical: 24 }}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primaryGlow }]}>
            <Ionicons name="people-outline" size={28} color={colors.primary} />
          </View>
          <Text variant="heading">Пока нет команд</Text>
          <Text muted style={{ textAlign: "center" }}>
            {isCoach ? "Создайте свою первую команду, чтобы начать, или вступите по приглашению." : "Вы пока не состоите ни в одной команде. Попросите тренера прислать ссылку-приглашение."}
          </Text>
          {isCoach ? <Button title="Создать команду" onPress={() => router.push("/team/new")} style={{ alignSelf: "stretch" }} /> : null}
          {!isCoach ? <Button title="А пока — найти личного тренера" variant="secondary" onPress={() => router.push("/coaches")} style={{ alignSelf: "stretch" }} /> : null}
        </Card>
      ) : (
        list.map((team) => <TeamCard key={team.id} team={team} />)
      )}

      <ListRow icon="clipboard-outline" title={isCoach ? "Задания команд" : "Мои задания"} subtitle={isCoach ? "Отчёты игроков и проверка" : "Что задал тренер и что уже сделано"} onPress={() => router.push("/my-tasks")} />
      <ListRow icon="link-outline" title="Вступить по приглашению" subtitle="Ссылка или код от тренера" onPress={() => router.push("/join")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, textTransform: "uppercase" },
  add: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingVertical: 8, paddingLeft: 10, paddingRight: 14 },
  card: { borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22, textTransform: "uppercase", flexShrink: 1 },
  badge: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
