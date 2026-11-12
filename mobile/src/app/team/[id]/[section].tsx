import { Stack, useLocalSearchParams } from "expo-router";
import { getTeam } from "@/api/teams";
import { useLoad } from "@/lib/useLoad";
import { InvitesSection } from "@/team/InvitesSection";
import { LibrarySection } from "@/team/LibrarySection";
import { MatchesSection } from "@/team/MatchesSection";
import { MembersSection } from "@/team/MembersSection";
import { StatsSection } from "@/team/StatsSection";
import { TasksSection } from "@/team/TasksSection";
import { TrainingsSection } from "@/team/TrainingsSection";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";

const TITLES: Record<string, string> = {
  members: "Состав",
  trainings: "Тренировки",
  matches: "Матчи",
  tasks: "Задания",
  library: "Упражнения и планы",
  stats: "Статистика",
  invites: "Приглашения",
};

/** One section of a team (opened from its tile). */
export default function TeamSectionScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section: string }>();
  const team = useLoad(() => getTeam(id), [id]);
  const title = TITLES[section] ?? "Команда";

  if (team.loading && !team.data) return <LoadingView />;
  if (team.error || !team.data) return <ErrorView message={team.error ?? "Команда не найдена"} onRetry={team.reload} />;
  const t = team.data;
  const staff = t.myRole === "head_coach" || t.myRole === "assistant_coach";

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `${title} · ${t.name}` }} />
      <Screen header>
        {section === "members" ? <MembersSection team={t} staff={staff} /> : null}
        {section === "trainings" ? <TrainingsSection team={t} staff={staff} /> : null}
        {section === "matches" ? <MatchesSection team={t} staff={staff} /> : null}
        {section === "tasks" ? <TasksSection team={t} staff={staff} /> : null}
        {section === "library" ? <LibrarySection team={t} staff={staff} /> : null}
        {section === "stats" ? <StatsSection team={t} staff={staff} /> : null}
        {section === "invites" && staff ? <InvitesSection team={t} /> : null}
      </Screen>
    </>
  );
}
