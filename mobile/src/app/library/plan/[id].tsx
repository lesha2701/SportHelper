import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { listMyExercises } from "@/api/exercises";
import { addPlanExercise, deletePlan, duplicatePlan, getPlan, removePlanExercise, sharePlan, unsharePlan } from "@/api/plans";
import { ShareWithTeams } from "@/library/ShareWithTeams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { PLAN_SECTIONS, PLAN_SECTION_LABELS, type PlanSection } from "@/shared/types/plan";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const plan = useLoad(() => getPlan(id), [id]);
  const exercises = useLoad(listMyExercises);
  const [adding, setAdding] = useState(false);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [section, setSection] = useState<PlanSection>("main");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const reload = plan.reload;
  useFocusEffect(useCallback(() => reload(), [reload]));

  if (plan.loading && !plan.data) return <LoadingView />;
  if (plan.error || !plan.data) return <ErrorView message={plan.error ?? "План не найден"} onRetry={plan.reload} />;
  const p = plan.data;

  async function add() {
    if (!exerciseId) return setError("Выберите упражнение.");
    const chosen = exercises.data?.find((e) => e.id === exerciseId);
    try {
      await addPlanExercise(p.id, {
        exercise_id: exerciseId,
        section,
        order_index: p.exercises.length,
        sets: chosen?.sets ?? null,
        reps: chosen?.reps ?? null,
        duration_seconds: chosen?.durationSeconds ?? null,
        rest_seconds: chosen?.restSeconds ?? null,
        notes: null,
      });
      setAdding(false);
      setExerciseId(null);
      setError(null);
      plan.reload();
    } catch (e) {
      setError(toFormError(e).message);
    }
  }

  async function removeItem(planExerciseId: string) {
    try {
      await removePlanExercise(p.id, planExerciseId);
      plan.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  async function removePlan() {
    setDeleting(false);
    try {
      await deletePlan(p.id);
      router.back();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "План" }} />
      <Screen header>
        <Text variant="title">{p.name}</Text>
        <Text muted>{[p.sport, p.durationMinutes ? `${p.durationMinutes} мин` : null, p.equipment].filter(Boolean).join(" · ")}</Text>
        {p.description ? <Text>{p.description}</Text> : null}
        {p.comment ? <Text muted>Комментарий: {p.comment}</Text> : null}

        {PLAN_SECTIONS.map((s) => {
          const items = p.exercises.filter((e) => e.section === s).sort((a, b) => a.orderIndex - b.orderIndex);
          if (items.length === 0) return null;
          return (
            <Card key={s}>
              <Text variant="heading">{PLAN_SECTION_LABELS[s]}</Text>
              {items.map((e) => (
                <View key={e.id} style={{ gap: 4 }}>
                  <Text variant="label">{e.exerciseName ?? "Упражнение"}</Text>
                  <Text muted>{[e.sets && e.reps ? `${e.sets}×${e.reps}` : null, e.durationSeconds ? `${e.durationSeconds} с` : null].filter(Boolean).join(" · ")}</Text>
                  <Button title="Убрать из плана" variant="ghost" onPress={() => void removeItem(e.id)} />
                </View>
              ))}
            </Card>
          );
        })}
        {p.exercises.length === 0 ? <Text muted>В плане пока нет упражнений.</Text> : null}

        {adding ? (
          <Card>
            <Text variant="heading">Добавить упражнение</Text>
            {exercises.data?.length === 0 ? <Text muted>Сначала создайте упражнения в библиотеке.</Text> : null}
            <Choice layout="chips" options={(exercises.data ?? []).map((e) => ({ value: e.id, title: e.name }))} value={exerciseId} onChange={setExerciseId} />
            <Choice label="Часть тренировки" layout="chips" options={PLAN_SECTIONS.map((s) => ({ value: s, title: PLAN_SECTION_LABELS[s] }))} value={section} onChange={setSection} />
            {error ? <Notice kind="danger">{error}</Notice> : null}
            <Button title="Добавить" onPress={add} />
            <Button title="Отмена" variant="ghost" onPress={() => setAdding(false)} />
          </Card>
        ) : (
          <Button title="Добавить упражнение" variant="secondary" onPress={() => setAdding(true)} />
        )}
        <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/library/plan/new", params: { id: p.id } })} />
        <Button
          title="Сделать копию"
          variant="secondary"
          onPress={async () => {
            try {
              const copy = await duplicatePlan(p.id);
              router.push({ pathname: "/library/plan/[id]", params: { id: copy.id } });
            } catch (e) {
              toast.error(toFormError(e).message);
            }
          }}
        />
        <ShareWithTeams key={p.sharedTeamIds.join()} sharedTeamIds={p.sharedTeamIds} share={(t) => sharePlan(p.id, t)} unshare={(t) => unsharePlan(p.id, t)} what="этот план" />
        <Button title="Удалить план" variant="ghost" onPress={() => setDeleting(true)} />
        <ConfirmModal visible={deleting} title="Удалить план?" confirmLabel="Удалить" destructive onCancel={() => setDeleting(false)} onConfirm={() => void removePlan()} />
      </Screen>
    </>
  );
}
