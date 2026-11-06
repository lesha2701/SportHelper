import { Stack, router } from "expo-router";
import { listMyTasks, listTeamTasks } from "@/api/tasks";
import { listMyTeams } from "@/api/teams";
import { useAuth } from "@/auth/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { formatRuDate } from "@/shared/lib/dates";
import { TASK_STATUS_LABELS, type Task } from "@/shared/types/task";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

/** The player's tasks: what was given to me and where I stand. */
function PlayerTasks() {
  const tasks = useLoad(listMyTasks);
  if (tasks.loading && !tasks.data) return <LoadingView />;
  if (tasks.error && !tasks.data) return <ErrorView message={tasks.error} onRetry={tasks.reload} />;
  const order = ["needs_revision", "assigned", "viewed", "in_progress", "overdue", "submitted", "accepted", "missed", "cancelled"];
  const items = [...(tasks.data ?? [])].sort((a, b) => order.indexOf(a.assignment.status) - order.indexOf(b.assignment.status));

  return (
    <Screen header onRefresh={tasks.reload} refreshing={tasks.loading}>
      {items.length === 0 ? <Text muted>Заданий пока нет. Когда тренер назначит задание, оно появится здесь.</Text> : null}
      {items.map(({ task, assignment }) => (
        <Card key={task.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}>
          <Text variant="label">{task.title}</Text>
          <Text muted>
            {[TASK_STATUS_LABELS[assignment.status], task.deadline ? `до ${formatRuDate(task.deadline.slice(0, 10))}` : null].filter(Boolean).join(" · ")}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

interface TeamTask {
  task: Task;
  teamName: string;
}

/** The coach's tasks across all their teams, the ones with reports to check first. */
function CoachTasks() {
  const tasks = useLoad(async () => {
    const teams = (await listMyTeams()).filter((t) => t.myRole === "head_coach" || t.myRole === "assistant_coach");
    const lists = await Promise.all(teams.map(async (t) => (await listTeamTasks(t.id)).map((task): TeamTask => ({ task, teamName: t.name }))));
    return lists.flat();
  });
  if (tasks.loading && !tasks.data) return <LoadingView />;
  if (tasks.error && !tasks.data) return <ErrorView message={tasks.error} onRetry={tasks.reload} />;
  const waiting = (t: Task) => t.assignments.filter((a) => a.status === "submitted").length;
  const items = [...(tasks.data ?? [])].sort((a, b) => waiting(b.task) - waiting(a.task));

  return (
    <Screen header onRefresh={tasks.reload} refreshing={tasks.loading}>
      {items.length === 0 ? <Text muted>Заданий пока нет. Создайте задание в разделе «Задания» вашей команды.</Text> : null}
      {items.map(({ task, teamName }) => {
        const n = waiting(task);
        const done = task.assignments.filter((a) => a.status === "accepted").length;
        return (
          <Card key={task.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}>
            <Text variant="label">{task.title}</Text>
            <Text muted>
              {[teamName, task.deadline ? `до ${formatRuDate(task.deadline.slice(0, 10))}` : null, `принято ${done} из ${task.assignments.length}`].filter(Boolean).join(" · ")}
            </Text>
            {n > 0 ? <Text variant="caption" style={{ color: "#e85d2a" }}>Ждут проверки: {n}</Text> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

export default function TasksScreen() {
  const { user } = useAuth();
  const coach = user?.preferredRole === "coach";
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: coach ? "Задания команд" : "Мои задания" }} />
      {coach ? <CoachTasks /> : <PlayerTasks />}
    </>
  );
}
