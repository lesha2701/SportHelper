import { router, useLocalSearchParams } from "expo-router";
import { getTraining, updateTraining } from "@/api/trainings";
import { useLoad } from "@/lib/useLoad";
import { parseExerciseChecklist } from "@/shared/lib/trainingDescription";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { readDraft } from "@/workout/drafts";
import { WorkoutSession } from "@/workout/WorkoutSession";

/** The guided workout of a personal training. */
export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loaded = useLoad(async () => {
    const training = await getTraining(id);
    const checklist = training.description ? parseExerciseChecklist(training.description) : null;
    const draft = checklist ? await readDraft(training.id, checklist.items.length) : null;
    return { training, checklist, draft };
  }, [id]);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Тренировка не найдена"} onRetry={loaded.reload} />;
  const { training, checklist, draft } = loaded.data;
  if (!checklist) return <ErrorView message="В этой тренировке нет списка упражнений." />;

  return (
    <WorkoutSession
      trainingId={training.id}
      items={checklist.items}
      notes={checklist.notes}
      initialDraft={draft}
      onExit={() => router.back()}
      onSaved={() => {
        // Doing the workout is the training: the plan is marked as held without another tap.
        if (training.status === "scheduled") {
          void updateTraining(training.id, {
            training_date: training.trainingDate,
            start_time: training.startTime.slice(0, 5),
            duration_minutes: training.durationMinutes,
            location: training.location,
            description: training.description,
            plan_id: training.planId,
            reminder_minutes_before: training.reminderMinutesBefore,
            status: "completed",
            is_independent: false,
            responsible_user_id: training.responsibleUserId,
          }).catch(() => {});
        }
      }}
    />
  );
}
