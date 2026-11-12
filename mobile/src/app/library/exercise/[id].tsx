import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { deleteExercise, getExercise, shareExercise, unshareExercise } from "@/api/exercises";
import { useAuth } from "@/auth/AuthProvider";
import { ShareWithTeams } from "@/library/ShareWithTeams";
import { isLibraryOwner } from "@/lib/teamLibrary";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { AuthImage } from "@/ui/AuthImage";
import { AuthVideo } from "@/ui/AuthVideo";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { user } = useAuth();
  const exercise = useLoad(() => getExercise(id), [id]);
  const [deleting, setDeleting] = useState(false);
  const reload = exercise.reload;
  // Back from editing: show the saved version.
  useFocusEffect(useCallback(() => reload(), [reload]));

  if (exercise.loading && !exercise.data) return <LoadingView />;
  if (exercise.error || !exercise.data) return <ErrorView message={exercise.error ?? "Упражнение не найдено"} onRetry={exercise.reload} />;
  const e = exercise.data;
  // The exercise of another coach, opened to a team, is only read: the author's tools are not shown.
  const owner = isLibraryOwner(user?.id, e.ownerId);

  async function remove() {
    setDeleting(false);
    try {
      await deleteExercise(e.id);
      router.back();
    } catch (err) {
      toast.error(toFormError(err).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Упражнение" }} />
      <Screen header>
        <Text variant="title">{e.name}</Text>
        {e.photoFileId ? <AuthImage fileId={e.photoFileId} height={220} /> : null}
        <Card>
          <Row label="Вид спорта" value={e.sport} />
          <Row label="Описание" value={e.description} />
          <Row label="Цель" value={e.goal} />
          <Row label="Подходов" value={e.sets} />
          <Row label="Повторений" value={e.reps} />
          <Row label="Длительность, с" value={e.durationSeconds} />
          <Row label="Отдых, с" value={e.restSeconds} />
          <Row label="Инвентарь" value={e.equipment} />
          <Row label="Сложность" value={e.difficulty ? SKILL_LEVEL_LABELS[e.difficulty] : null} />
          <Row label="Техника" value={e.technique} />
          <Row label="Частые ошибки" value={e.commonMistakes} />
          <Row label="Предостережения" value={e.warnings} />
          <Row label="Комментарий тренера" value={e.coachComment} />
        </Card>
        {e.videoFileId ? <AuthVideo fileId={e.videoFileId} /> : null}
        {owner ? (
          <>
            <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/library/exercise/new", params: { id: e.id } })} />
            <ShareWithTeams key={e.sharedTeamIds.join()} sharedTeamIds={e.sharedTeamIds} share={(t) => shareExercise(e.id, t)} unshare={(t) => unshareExercise(e.id, t)} what="это упражнение" />
            <Button title="Удалить упражнение" variant="ghost" onPress={() => setDeleting(true)} />
          </>
        ) : null}
        <ConfirmModal visible={deleting} title="Удалить упражнение?" confirmLabel="Удалить" destructive onCancel={() => setDeleting(false)} onConfirm={() => void remove()} />
      </Screen>
    </>
  );
}
