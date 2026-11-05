import { router } from "expo-router";
import { listMyTeams } from "@/api/teams";
import { useLoad } from "@/lib/useLoad";
import { useAuth } from "@/auth/AuthProvider";
import { TEAM_ROLE_LABELS } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { count } from "@/shared/lib/plural";

export default function TeamsScreen() {
  const { user } = useAuth();
  const teams = useLoad(listMyTeams);
  const isCoach = user?.preferredRole === "coach" || user?.isAdmin;

  if (teams.loading && !teams.data) return <LoadingView />;
  if (teams.error && !teams.data) return <ErrorView message={teams.error} onRetry={teams.reload} />;

  return (
    <Screen onRefresh={teams.reload} refreshing={teams.loading && !!teams.data}>
      <Text variant="title">Команды</Text>
      {teams.data?.length === 0 ? (
        <Card>
          <Text variant="heading">Пока нет команд</Text>
          <Text muted>{isCoach ? "Создайте команду или вступите по приглашению." : "Вступите в команду по ссылке-приглашению от тренера."}</Text>
        </Card>
      ) : null}
      {teams.data?.map((team) => (
        <Card key={team.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}>
          <Text variant="heading">{team.name}</Text>
          <Text muted>
            {[team.sport, team.myRole ? TEAM_ROLE_LABELS[team.myRole] : null, count(team.membersCount, "участник", "участника", "участников")]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {team.status === "without_coach" ? <Text variant="caption">Нет главного тренера</Text> : null}
        </Card>
      ))}
      {isCoach ? <Button title="Создать команду" onPress={() => router.push("/team/new")} /> : null}
      <Button title="Вступить по приглашению" variant="secondary" onPress={() => router.push("/join")} />
    </Screen>
  );
}
