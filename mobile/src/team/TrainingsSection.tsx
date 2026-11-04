import { router } from "expo-router";
import { listTeamTrainings } from "@/api/trainings";
import { useLoad } from "@/lib/useLoad";
import { formatDayTitle, shortTime } from "@/shared/lib/dates";
import type { Team } from "@/shared/types/team";
import { TRAINING_STATUS_LABELS } from "@/shared/types/training";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

export function TrainingsSection({ team, staff }: { team: Team; staff: boolean }) {
  const trainings = useLoad(() => listTeamTrainings(team.id), [team.id]);
  if (trainings.loading && !trainings.data) return <LoadingView />;
  if (trainings.error && !trainings.data) return <ErrorView message={trainings.error} onRetry={trainings.reload} />;

  const sorted = [...(trainings.data ?? [])].sort((a, b) => (a.trainingDate + a.startTime).localeCompare(b.trainingDate + b.startTime));
  return (
    <>
      {staff ? <Button title="Новая тренировка" onPress={() => router.push({ pathname: "/training/new", params: { teamId: team.id } })} /> : null}
      {sorted.length === 0 ? <Text muted>Тренировок пока нет.</Text> : null}
      {sorted.map((t) => (
        <Card key={t.id} onPress={() => router.push({ pathname: "/training/[id]", params: { id: t.id, teamId: team.id } })}>
          <Text variant="label">
            {formatDayTitle(t.trainingDate)}, {shortTime(t.startTime)}
          </Text>
          <Text muted>{[t.location, `${t.durationMinutes} мин`, TRAINING_STATUS_LABELS[t.status]].filter(Boolean).join(" · ")}</Text>
        </Card>
      ))}
    </>
  );
}
