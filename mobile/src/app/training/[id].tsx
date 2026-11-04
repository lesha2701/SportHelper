import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { getTeam } from "@/api/teams";
import { deleteTraining, getAttendance, getTraining, getTrainingWorkout, setAttendanceStatus, updateTraining } from "@/api/trainings";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { formatDayTitle, shortTime } from "@/shared/lib/dates";
import { parseExerciseChecklist } from "@/shared/lib/trainingDescription";
import { describeSets, formatClock, workoutTotals } from "@/shared/lib/workout";
import { count } from "@/shared/lib/plural";
import { TRAINING_STATUS_LABELS, type Training } from "@/shared/types/training";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

function Attendance({ training }: { training: Training }) {
  const list = useLoad(() => getAttendance(training.id), [training.id]);
  const toast = useToast();
  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;

  async function toggle(userId: string, present: boolean) {
    try {
      await setAttendanceStatus(training.id, userId, present ? "absent" : "present");
      list.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="heading">Посещаемость</Text>
      {list.data?.map((a) => (
        <View key={a.userId} style={{ gap: 6 }}>
          <Text>{[a.firstName, a.lastName].filter(Boolean).join(" ")}</Text>
          <Button
            title={a.status === "present" ? "Был(а) — нажмите, чтобы снять" : "Не был(а) — нажмите, чтобы отметить"}
            variant={a.status === "present" ? "primary" : "secondary"}
            onPress={() => void toggle(a.userId, a.status === "present")}
          />
        </View>
      ))}
    </Card>
  );
}

function SavedWorkout({ trainingId }: { trainingId: string }) {
  const workout = useLoad(() => getTrainingWorkout(trainingId), [trainingId]);
  if (!workout.data) return null;
  const totals = workoutTotals(workout.data.exercises);
  const spent =
    workout.data.startedAt && workout.data.finishedAt
      ? Math.max(0, Math.round((Date.parse(workout.data.finishedAt) - Date.parse(workout.data.startedAt)) / 1000))
      : null;
  return (
    <Card>
      <Text variant="heading">Результат</Text>
      <Text muted>
        {[count(totals.setsDone, "подход", "подхода", "подходов"), spent ? formatClock(spent) : null].filter(Boolean).join(" · ")}
      </Text>
      {workout.data.exercises.map((e, i) => (
        <View key={i}>
          <Text variant="label">{e.name}</Text>
          <Text muted>{describeSets(e) || "не выполнено"}</Text>
        </View>
      ))}
    </Card>
  );
}

export default function TrainingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const training = useLoad(async () => {
    const t = await getTraining(id);
    const team = t.teamId ? await getTeam(t.teamId) : null;
    return { t, team };
  }, [id]);
  const [confirm, setConfirm] = useState<"delete" | "complete" | null>(null);

  if (training.loading && !training.data) return <LoadingView />;
  if (training.error || !training.data) return <ErrorView message={training.error ?? "Тренировка не найдена"} onRetry={training.reload} />;
  const { t, team } = training.data;

  const staff = team ? team.myRole === "head_coach" || team.myRole === "assistant_coach" : false;
  const mine = t.type === "personal" && t.createdBy === user?.id;
  const checklist = mine && t.description ? parseExerciseChecklist(t.description) : null;

  async function complete() {
    setConfirm(null);
    try {
      await updateTraining(t.id, {
        training_date: t.trainingDate,
        start_time: t.startTime.slice(0, 5),
        duration_minutes: t.durationMinutes,
        location: t.location,
        description: t.description,
        plan_id: t.planId,
        reminder_minutes_before: t.reminderMinutesBefore,
        status: "completed",
        is_independent: t.type === "independent",
        responsible_user_id: t.responsibleUserId,
      });
      training.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  async function remove() {
    setConfirm(null);
    try {
      await deleteTraining(t.id);
      router.back();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Тренировка" }} />
      <Screen>
        <Text variant="title">{formatDayTitle(t.trainingDate)}</Text>
        <Card>
          <Text variant="heading">{shortTime(t.startTime)}</Text>
          <Text muted>{[team?.name, t.location, `${t.durationMinutes} мин`, TRAINING_STATUS_LABELS[t.status]].filter(Boolean).join(" · ")}</Text>
          {t.description && !checklist ? <Text>{t.description}</Text> : null}
          {t.reminderMinutesBefore !== null ? <Text variant="caption">Напоминание за {t.reminderMinutesBefore} мин</Text> : null}
        </Card>

        {checklist ? (
          <Card>
            <Text variant="heading">План</Text>
            {checklist.items.map((item, i) => (
              <Text key={i}>
                {i + 1}. {item.text}
              </Text>
            ))}
            {checklist.notes ? <Text muted>Пометки: {checklist.notes}</Text> : null}
            {t.status !== "cancelled" ? <Button title="Начать тренировку" onPress={() => router.push({ pathname: "/workout/[id]", params: { id: t.id } })} /> : null}
          </Card>
        ) : null}

        {mine ? <SavedWorkout trainingId={t.id} /> : null}
        {staff ? <Attendance training={t} /> : null}

        {staff && t.status === "scheduled" ? <Button title="Отметить проведённой" variant="secondary" onPress={() => setConfirm("complete")} /> : null}
        {staff || mine ? <Button title="Удалить тренировку" variant="ghost" onPress={() => setConfirm("delete")} /> : null}

        <ConfirmModal
          visible={confirm !== null}
          title={confirm === "delete" ? "Удалить тренировку?" : "Отметить проведённой?"}
          confirmLabel={confirm === "delete" ? "Удалить" : "Отметить"}
          destructive={confirm === "delete"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void (confirm === "delete" ? remove() : complete())}
        />
      </Screen>
    </>
  );
}
