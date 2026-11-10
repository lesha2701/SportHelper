import { router } from "expo-router";
import { listTeamTasks } from "@/api/tasks";
import { useLoad } from "@/lib/useLoad";
import { formatRuDate } from "@/shared/lib/dates";
import type { Team } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

export function TasksSection({ team, staff }: { team: Team; staff: boolean }) {
  const tasks = useLoad(() => listTeamTasks(team.id), [team.id]);
  if (tasks.loading && !tasks.data) return <LoadingView />;
  if (tasks.error && !tasks.data) return <ErrorView message={tasks.error} onRetry={tasks.reload} />;

  return (
    <>
      {staff ? <Button title="Новое задание" onPress={() => router.push({ pathname: "/task/new", params: { teamId: team.id } })} /> : null}
      {tasks.data?.length === 0 ? <Text muted>Заданий пока нет.</Text> : null}
      {tasks.data?.map((t) => {
        const submitted = t.assignments.filter((a) => a.status === "submitted").length;
        return (
          <Card key={t.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}>
            <Text variant="label">{t.title}</Text>
            <Text muted>
              {[t.deadline ? `до ${formatRuDate(t.deadline.slice(0, 10))}` : null, `${t.assignments.length} исполнителей`].filter(Boolean).join(" · ")}
            </Text>
            {submitted > 0 ? <Text variant="caption">Ждут проверки: {submitted}</Text> : null}
          </Card>
        );
      })}
    </>
  );
}
