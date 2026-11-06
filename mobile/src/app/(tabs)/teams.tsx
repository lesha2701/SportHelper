import { router } from "expo-router";
import { View } from "react-native";
import { listMyTeams } from "@/api/teams";
import { useAuth } from "@/auth/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { count } from "@/shared/lib/plural";
import { TEAM_ROLE_LABELS } from "@/shared/types/team";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

export default function TeamsScreen() {
  const { user } = useAuth();
  const teams = useLoad(listMyTeams);
  const isCoach = user?.preferredRole === "coach" || user?.isAdmin;

  if (teams.loading && !teams.data) return <LoadingView />;
  if (teams.error && !teams.data) return <ErrorView message={teams.error} onRetry={teams.reload} />;

  return (
    <Screen header onRefresh={teams.reload} refreshing={teams.loading && !!teams.data}>
      <ListRow
        icon="clipboard-outline"
        title={isCoach ? "Задания команд" : "Мои задания"}
        subtitle={isCoach ? "Отчёты игроков и проверка" : "Что задал тренер и что уже сделано"}
        onPress={() => router.push("/my-tasks")}
      />
      {teams.data?.length === 0 ? (
        <Card>
          <Text variant="heading">Пока нет команд</Text>
          <Text muted>{isCoach ? "Создайте команду или вступите по приглашению." : "Вступите в команду по ссылке-приглашению от тренера."}</Text>
        </Card>
      ) : null}
      {teams.data?.map((team) => (
        <Card key={team.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Avatar fileId={team.logoFileId} name={team.name} size={48} square />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{team.name}</Text>
              <Text muted>
                {[team.sport, team.myRole ? TEAM_ROLE_LABELS[team.myRole] : null, count(team.membersCount, "участник", "участника", "участников")]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {team.status === "without_coach" ? <Text variant="caption">Нет главного тренера</Text> : null}
            </View>
          </View>
        </Card>
      ))}
      {isCoach ? <Button title="Создать команду" onPress={() => router.push("/team/new")} /> : null}
      <Button title="Вступить по приглашению" variant="secondary" onPress={() => router.push("/join")} />
    </Screen>
  );
}
