import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, View } from "react-native";
import { deleteTask, getTask, reviewTask, startTask, submitTask, uploadTaskPhoto, uploadTaskVideo } from "@/api/tasks";
import { getTeam } from "@/api/teams";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { formatRuDate } from "@/shared/lib/dates";
import { TASK_STATUS_LABELS, type Task, type TaskAssignment, type TaskReviewDecision, type TaskSubmitInput } from "@/shared/types/task";
import { Button } from "@/ui/Button";
import { AuthImage } from "@/ui/AuthImage";
import { AuthVideo } from "@/ui/AuthVideo";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), title: String(n) }));
const int = (text: string) => (text.trim() ? parseInt(text, 10) || null : null);

interface Picked {
  uri: string;
  name: string;
  type: string;
  video: boolean;
}

function AssignmentReport({ a }: { a: TaskAssignment }) {
  return (
    <>
      {a.comment ? <Text>{a.comment}</Text> : null}
      {a.sets || a.reps ? <Text muted>Подходов: {a.sets ?? "—"}, повторений: {a.reps ?? "—"}</Text> : null}
      {a.durationMinutes ? <Text muted>Длительность: {a.durationMinutes} мин</Text> : null}
      {a.difficulty ? <Text muted>Сложность: {a.difficulty}/5</Text> : null}
      {a.wellbeing ? <Text muted>Самочувствие: {a.wellbeing}/5</Text> : null}
      {a.photoFileId ? <AuthImage fileId={a.photoFileId} /> : null}
      {a.videoFileId ? <AuthVideo fileId={a.videoFileId} /> : null}
      {a.coachComment ? <Notice>Комментарий тренера: {a.coachComment}</Notice> : null}
    </>
  );
}

/** The player's own part: take the task, fill in the report (with a photo or video when asked) and send it. */
function PlayerPart({ task, mine, onChanged }: { task: Task; mine: TaskAssignment; onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ comment: "", sets: "", reps: "", minutes: "", difficulty: "", wellbeing: "" });
  const [media, setMedia] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const canSubmit = mine.status !== "submitted" && mine.status !== "accepted" && mine.status !== "cancelled" && mine.status !== "missed";

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: task.requireVideo && !task.requirePhoto ? ["videos"] : task.requirePhoto && !task.requireVideo ? ["images"] : ["images", "videos"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const video = asset.type === "video";
    setMedia({ uri: asset.uri, name: asset.fileName ?? (video ? "video.mp4" : "photo.jpg"), type: asset.mimeType ?? (video ? "video/mp4" : "image/jpeg"), video });
  }

  async function start() {
    try {
      await startTask(task.id);
      onChanged();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  async function submit() {
    setError(null);
    if (task.requireComment && !form.comment.trim()) return setError("Напишите комментарий к отчёту.");
    if ((task.requirePhoto && !(media && !media.video) && !mine.photoFileId) || (task.requireVideo && !(media && media.video) && !mine.videoFileId)) {
      return setError(task.requirePhoto && task.requireVideo ? "Приложите фото и видео." : task.requirePhoto ? "Приложите фото." : "Приложите видео.");
    }
    const input: TaskSubmitInput = {
      comment: form.comment.trim() || null,
      sets: int(form.sets),
      reps: int(form.reps),
      duration_minutes: int(form.minutes),
      metric_value: null,
      difficulty: int(form.difficulty),
      wellbeing: int(form.wellbeing),
    };
    setBusy(true);
    try {
      if (media) {
        const file = { uri: media.uri, name: media.name, type: media.type };
        if (media.video) await uploadTaskVideo(task.id, file);
        else await uploadTaskPhoto(task.id, file);
      }
      await submitTask(task.id, input);
      onChanged();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Моё выполнение</Text>
      <Text muted>{TASK_STATUS_LABELS[mine.status]}</Text>
      <AssignmentReport a={mine} />
      {mine.status === "assigned" || mine.status === "viewed" ? <Button title="Взять в работу" variant="secondary" onPress={start} /> : null}
      {canSubmit ? (
        <>
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <TextField label={task.requireComment ? "Комментарий *" : "Комментарий"} value={form.comment} onChangeText={(comment) => set({ comment })} multiline numberOfLines={3} maxLength={2000} />
          {task.requireSetsReps ? (
            <>
              <TextField label="Подходов" value={form.sets} onChangeText={(sets) => set({ sets })} keyboardType="number-pad" maxLength={3} />
              <TextField label="Повторений" value={form.reps} onChangeText={(reps) => set({ reps })} keyboardType="number-pad" maxLength={4} />
            </>
          ) : null}
          {task.requireDuration ? <TextField label="Длительность, мин" value={form.minutes} onChangeText={(minutes) => set({ minutes })} keyboardType="number-pad" maxLength={4} /> : null}
          {task.requireDifficulty ? <Choice label="Сложность (1 — легко, 5 — очень тяжело)" layout="chips" options={SCALE} value={form.difficulty || null} onChange={(difficulty) => set({ difficulty })} /> : null}
          {task.requireWellbeing ? <Choice label="Самочувствие (1 — плохо, 5 — отлично)" layout="chips" options={SCALE} value={form.wellbeing || null} onChange={(wellbeing) => set({ wellbeing })} /> : null}
          {task.requirePhoto || task.requireVideo ? (
            <>
              {media && !media.video ? <AuthImagePreview uri={media.uri} /> : null}
              {media?.video ? <Text muted>Видео выбрано: {media.name}</Text> : null}
              <Button title={media ? "Выбрать другой файл" : task.requireVideo && !task.requirePhoto ? "Выбрать видео" : task.requirePhoto && !task.requireVideo ? "Выбрать фото" : "Выбрать фото или видео"} variant="secondary" onPress={pick} />
            </>
          ) : null}
          <Button title="Отправить отчёт" onPress={submit} loading={busy} />
        </>
      ) : null}
    </Card>
  );
}

function AuthImagePreview({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={{ width: "100%", height: 200, borderRadius: 8 }} resizeMode="cover" />;
}

/** The coach's part: who did what, and accepting a report or sending it back. */
function CoachPart({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const toast = useToast();
  const [comments, setComments] = useState<Record<string, string>>({});

  async function review(userId: string, decision: TaskReviewDecision) {
    try {
      await reviewTask(task.id, userId, decision, comments[userId]?.trim() || null);
      onChanged();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Text variant="heading">Исполнители</Text>
      {task.assignments.map((a) => (
        <Card key={a.userId}>
          <Text variant="label">{[a.firstName, a.lastName].filter(Boolean).join(" ")}</Text>
          <Text muted>{TASK_STATUS_LABELS[a.status]}</Text>
          {a.status === "submitted" || a.status === "accepted" || a.status === "needs_revision" ? <AssignmentReport a={a} /> : null}
          {a.status === "submitted" ? (
            <>
              <TextField label="Комментарий тренера" value={comments[a.userId] ?? ""} onChangeText={(text) => setComments((current) => ({ ...current, [a.userId]: text }))} multiline maxLength={1000} />
              <Button title="Принять" onPress={() => void review(a.userId, "accepted")} />
              <Button title="Вернуть на доработку" variant="secondary" onPress={() => void review(a.userId, "needs_revision")} />
            </>
          ) : null}
        </Card>
      ))}
    </>
  );
}

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const loaded = useLoad(async () => {
    const task = await getTask(id);
    const team = await getTeam(task.teamId);
    return { task, team };
  }, [id]);
  const [deleting, setDeleting] = useState(false);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Задание не найдено"} onRetry={loaded.reload} />;
  const { task, team } = loaded.data;
  const staff = team.myRole === "head_coach" || team.myRole === "assistant_coach";
  const mine = task.assignments.find((a) => a.userId === user?.id);

  async function remove() {
    setDeleting(false);
    try {
      await deleteTask(task.id);
      router.back();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Задание" }} />
      <Screen>
        <Text variant="title">{task.title}</Text>
        <Text muted>{[team.name, task.deadline ? `до ${formatRuDate(task.deadline.slice(0, 10))}` : null].filter(Boolean).join(" · ")}</Text>
        {task.description ? <Text>{task.description}</Text> : null}
        {staff ? <CoachPart task={task} onChanged={loaded.reload} /> : null}
        {!staff && mine ? <PlayerPart task={task} mine={mine} onChanged={loaded.reload} /> : null}
        {staff ? <Button title="Удалить задание" variant="ghost" onPress={() => setDeleting(true)} /> : null}
        <ConfirmModal visible={deleting} title="Удалить задание?" confirmLabel="Удалить" destructive onCancel={() => setDeleting(false)} onConfirm={() => void remove()} />
        <View />
      </Screen>
    </>
  );
}
