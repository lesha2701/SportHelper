import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getTeam, leaveTeam, listApplications, uploadTeamLogo } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { pickSquareImage } from "@/lib/pickImage";
import { useLoad } from "@/lib/useLoad";
import { count } from "@/shared/lib/plural";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { TEAM_ROLE_LABELS } from "@/shared/types/team";
import { useChatUnread } from "@/lib/useChatUnread";
import { TeamChatRow } from "@/team/TeamChatRow";
import { TeamTile } from "@/team/TeamTile";
import { TransferOwnership } from "@/team/TransferOwnership";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

export type TeamSection = "members" | "trainings" | "matches" | "tasks" | "stats" | "invites";

function Tag({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="caption">{text}</Text>
    </View>
  );
}

/** A team: who it is (logo, sport, level, my role, description) and its sections as tiles. */
export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const team = useLoad(async () => {
    const t = await getTeam(id);
    const staff = t.myRole === "head_coach" || t.myRole === "assistant_coach";
    const requests = staff ? (await listApplications(t.id).catch(() => [])).filter((a) => a.status === "pending").length : 0;
    return { t, staff, requests };
  }, [id]);
  const chats = useChatUnread();
  const [leaving, setLeaving] = useState(false);
  const [transferring, setTransferring] = useState(false);

  if (team.loading && !team.data) return <LoadingView />;
  if (team.error || !team.data) return <ErrorView message={team.error ?? "Команда не найдена"} onRetry={team.reload} />;
  const { t, staff, requests } = team.data;
  const head = t.myRole === "head_coach";
  const open = (section: TeamSection) => router.push({ pathname: "/team/[id]/[section]", params: { id: t.id, section } });

  async function changeLogo() {
    const file = await pickSquareImage();
    if (!file) return;
    try {
      await uploadTeamLogo(t.id, file);
      team.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  async function leave() {
    setLeaving(false);
    try {
      await leaveTeam(t.id);
      router.replace("/teams");
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Команда" }} />
      <Screen header onRefresh={team.reload} refreshing={team.loading}>
        <Card>
          <View style={styles.headRow}>
            <Avatar fileId={t.logoFileId} name={t.name} size={72} square />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.text }]}>{t.name}</Text>
              {t.myRole ? (
                <Text variant="label" style={{ color: colors.primary }}>
                  {TEAM_ROLE_LABELS[t.myRole]}
                </Text>
              ) : null}
              <Text variant="caption" muted>
                {count(t.membersCount, "участник", "участника", "участников")}
              </Text>
            </View>
          </View>
          <View style={styles.tags}>
            <Tag text={t.sport} />
            {t.level ? <Tag text={SKILL_LEVEL_LABELS[t.level]} /> : null}
            {t.ageCategory ? <Tag text={t.ageCategory} /> : null}
          </View>
          {t.description ? <Text>{t.description}</Text> : null}
          {head ? (
            <View style={styles.headRow}>
              <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/team/new", params: { id: t.id } })} style={{ flex: 1 }} />
              <Button title="Логотип" variant="secondary" onPress={changeLogo} style={{ flex: 1 }} />
            </View>
          ) : null}
        </Card>

        <TeamChatRow teamId={t.id} members={t.membersCount} unread={chats.team[t.id] ?? 0} />

        <View style={styles.tiles}>
          <TeamTile icon="people-outline" title="Состав" subtitle="Игроки и тренеры, роли" onPress={() => open("members")} />
          <TeamTile icon="barbell-outline" title="Тренировки" subtitle={staff ? "Расписание и посещаемость" : "Расписание команды"} onPress={() => open("trainings")} />
          <TeamTile icon="football-outline" title="Матчи" subtitle={staff ? "Составы и итоги" : "Игры и результаты"} onPress={() => open("matches")} />
          <TeamTile icon="clipboard-outline" title="Задания" subtitle={staff ? "Задания и отчёты" : "Что задал тренер"} onPress={() => open("tasks")} />
          <TeamTile icon="stats-chart-outline" title="Статистика" subtitle="Посещаемость, задания, матчи" onPress={() => open("stats")} />
          {staff ? <TeamTile icon="person-add-outline" title="Приглашения" subtitle="Ссылка и заявки" badge={requests} onPress={() => open("invites")} /> : null}
        </View>

        {head ? <Button title="Передать роль главного тренера" variant="secondary" onPress={() => setTransferring(true)} /> : null}
        <Button title="Выйти из команды" variant="ghost" onPress={() => setLeaving(true)} />
        <TransferOwnership
          team={t}
          visible={transferring}
          onClose={() => setTransferring(false)}
          onDone={() => {
            setTransferring(false);
            team.reload();
          }}
        />
        <ConfirmModal
          visible={leaving}
          title="Выйти из команды?"
          message="Вы больше не будете видеть тренировки и задания команды."
          confirmLabel="Выйти"
          destructive
          onCancel={() => setLeaving(false)}
          onConfirm={() => void leave()}
        />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  name: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, textTransform: "uppercase" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 12 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
