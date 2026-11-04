import { router } from "expo-router";
import { listMyTasks } from "@/api/tasks";
import { useLoad } from "@/lib/useLoad";
import { formatRuDate } from "@/shared/lib/dates";
import { TASK_STATUS_LABELS } from "@/shared/types/task";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

/** The tasks given to me (the coach's own tasks are managed from the team screen). */
export default function TasksScreen() {
  const tasks = useLoad(listMyTasks);
  if (tasks.loading && !tasks.data) return <LoadingView />;
  if (tasks.error && !tasks.data) return <ErrorView message={tasks.error} onRetry={tasks.reload} />;

  return (
    <Screen>
      <Text variant="title">Задания</Text>
      {tasks.data?.length === 0 ? <Text muted>Заданий пока нет. Тренер увидит ваши отчёты здесь же.</Text> : null}
      {tasks.data?.map(({ task, assignment }) => (
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
