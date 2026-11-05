import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { getTeam } from "@/api/teams";
import { useLoad } from "@/lib/useLoad";
import { MatchesSection } from "@/team/MatchesSection";
import { MembersSection } from "@/team/MembersSection";
import { OverviewSection } from "@/team/OverviewSection";
import { StatsSection } from "@/team/StatsSection";
import { TasksSection } from "@/team/TasksSection";
import { TrainingsSection } from "@/team/TrainingsSection";
import { Choice } from "@/ui/Choice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Section = "overview" | "members" | "trainings" | "matches" | "tasks" | "stats";

const SECTIONS: { value: Section; title: string }[] = [
  { value: "overview", title: "Обзор" },
  { value: "members", title: "Состав" },
  { value: "trainings", title: "Тренировки" },
  { value: "matches", title: "Матчи" },
  { value: "tasks", title: "Задания" },
  { value: "stats", title: "Статистика" },
];

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const team = useLoad(() => getTeam(id), [id]);
  const [section, setSection] = useState<Section>("overview");

  if (team.loading && !team.data) return <LoadingView />;
  if (team.error || !team.data) return <ErrorView message={team.error ?? "Команда не найдена"} onRetry={team.reload} />;
  const t = team.data;
  const staff = t.myRole === "head_coach" || t.myRole === "assistant_coach";

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t.name }} />
      <Screen>
        <Text variant="title">{t.name}</Text>
        <Choice layout="chips" options={SECTIONS} value={section} onChange={setSection} />
        {section === "overview" ? <OverviewSection team={t} staff={staff} /> : null}
        {section === "members" ? <MembersSection team={t} staff={staff} /> : null}
        {section === "trainings" ? <TrainingsSection team={t} staff={staff} /> : null}
        {section === "matches" ? <MatchesSection team={t} staff={staff} /> : null}
        {section === "tasks" ? <TasksSection team={t} staff={staff} /> : null}
        {section === "stats" ? <StatsSection team={t} /> : null}
      </Screen>
    </>
  );
}
