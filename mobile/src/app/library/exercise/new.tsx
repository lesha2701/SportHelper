import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ApiError, type UploadFile } from "@/api/client";
import { createExercise, getExercise, updateExercise, uploadExercisePhoto, uploadExerciseVideo } from "@/api/exercises";
import { toFormError } from "@/lib/formError";
import { pickMedia } from "@/lib/pickImage";
import { COMMON_SPORTS, SKILL_LEVEL_LABELS, type SkillLevel } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const int = (text: string) => (text.trim() ? parseInt(text, 10) || null : null);
const str = (n: number | null) => (n === null ? "" : String(n));
const LEVELS = (Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]).map((l) => ({ value: l, title: SKILL_LEVEL_LABELS[l] }));

type Form = Record<"name" | "sport" | "description" | "goal" | "sets" | "reps" | "seconds" | "rest" | "equipment" | "technique" | "mistakes" | "warnings" | "comment", string>;
const EMPTY: Form = { name: "", sport: "", description: "", goal: "", sets: "", reps: "", seconds: "", rest: "", equipment: "", technique: "", mistakes: "", warnings: "", comment: "" };

/** A library exercise, new or edited (?id=), with every field of the website's form, a photo and a video. */
export default function ExerciseFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [form, setForm] = useState<Form>(EMPTY);
  const [level, setLevel] = useState<SkillLevel | null>(null);
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [video, setVideo] = useState<UploadFile | null>(null);
  const [has, setHas] = useState({ photo: false, video: false });
  const [loading, setLoading] = useState(!!id);
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!id) return;
    getExercise(id)
      .then((e) => {
        setForm({
          name: e.name,
          sport: e.sport,
          description: e.description ?? "",
          goal: e.goal ?? "",
          sets: str(e.sets),
          reps: str(e.reps),
          seconds: str(e.durationSeconds),
          rest: str(e.restSeconds),
          equipment: e.equipment ?? "",
          technique: e.technique ?? "",
          mistakes: e.commonMistakes ?? "",
          warnings: e.warnings ?? "",
          comment: e.coachComment ?? "",
        });
        setLevel(e.difficulty);
        setHas({ photo: !!e.photoFileId, video: !!e.videoFileId });
      })
      .catch((err: unknown) => setErrors({ form: toFormError(err).message }))
      .finally(() => setLoading(false));
  }, [id]);

  async function submit() {
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = "Укажите название.";
    if (!form.sport) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    const opt = (v: string) => v.trim() || null;
    const input = {
      sport: form.sport,
      name: form.name.trim(),
      description: opt(form.description),
      goal: opt(form.goal),
      sets: int(form.sets),
      reps: int(form.reps),
      duration_seconds: int(form.seconds),
      rest_seconds: int(form.rest),
      equipment: opt(form.equipment),
      difficulty: level,
      technique: opt(form.technique),
      common_mistakes: opt(form.mistakes),
      warnings: opt(form.warnings),
      coach_comment: opt(form.comment),
    };
    try {
      const saved = id ? await updateExercise(id, input) : await createExercise(input);
      if (photo) await uploadExercisePhoto(saved.id, photo);
      if (video) {
        try {
          await uploadExerciseVideo(saved.id, video);
        } catch (e) {
          if (e instanceof ApiError && e.code === "video_too_long") throw new Error("Упражнение сохранено, но видео длиннее допустимого — выберите короче.");
          throw e;
        }
      }
      if (id) router.back();
      else router.replace({ pathname: "/library/exercise/[id]", params: { id: saved.id } });
    } catch (e) {
      setErrors({ form: e instanceof Error && !(e instanceof ApiError) ? e.message : toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingView />;
  const sports = form.sport && !COMMON_SPORTS.includes(form.sport) ? [form.sport, ...COMMON_SPORTS] : COMMON_SPORTS;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: id ? "Редактировать упражнение" : "Новое упражнение" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={form.name} onChangeText={(name) => set({ name })} maxLength={200} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={sports.map((s) => ({ value: s, title: s }))} value={form.sport || null} onChange={(sport) => set({ sport })} error={errors.sport} />
        <TextField label="Описание" value={form.description} onChangeText={(description) => set({ description })} multiline numberOfLines={3} maxLength={2000} />
        <TextField label="Цель упражнения" value={form.goal} onChangeText={(goal) => set({ goal })} maxLength={500} />
        <TextField label="Подходов" value={form.sets} onChangeText={(sets) => set({ sets })} keyboardType="number-pad" maxLength={3} />
        <TextField label="Повторений" value={form.reps} onChangeText={(reps) => set({ reps })} keyboardType="number-pad" maxLength={4} />
        <TextField label="Длительность, секунд" value={form.seconds} onChangeText={(seconds) => set({ seconds })} keyboardType="number-pad" maxLength={5} />
        <TextField label="Отдых, секунд" value={form.rest} onChangeText={(rest) => set({ rest })} keyboardType="number-pad" maxLength={4} />
        <TextField label="Инвентарь" value={form.equipment} onChangeText={(equipment) => set({ equipment })} maxLength={200} />
        <Choice label="Сложность" layout="chips" options={LEVELS} value={level} onChange={(l) => setLevel(l === level ? null : l)} />
        <TextField label="Техника выполнения" value={form.technique} onChangeText={(technique) => set({ technique })} multiline numberOfLines={3} maxLength={2000} />
        <TextField label="Частые ошибки" value={form.mistakes} onChangeText={(mistakes) => set({ mistakes })} multiline numberOfLines={2} maxLength={2000} />
        <TextField label="Предостережения" value={form.warnings} onChangeText={(warnings) => set({ warnings })} multiline numberOfLines={2} maxLength={2000} />
        <TextField label="Комментарий тренера" value={form.comment} onChangeText={(comment) => set({ comment })} multiline numberOfLines={2} maxLength={2000} />
        {photo ? <Text muted>Фото выбрано: {photo.name}</Text> : null}
        <Button
          title={photo || has.photo ? "Заменить фото" : "Добавить фото"}
          variant="secondary"
          onPress={async () => {
            const f = await pickMedia("image");
            if (f) setPhoto(f);
          }}
        />
        {video ? <Text muted>Видео выбрано: {video.name}</Text> : null}
        <Button
          title={video || has.video ? "Заменить видео" : "Добавить видео"}
          variant="secondary"
          onPress={async () => {
            const f = await pickMedia("video");
            if (f) setVideo(f);
          }}
        />
        <Button title="Сохранить" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
