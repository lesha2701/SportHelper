import { Stack, router } from "expo-router";
import { useState } from "react";
import { createTemplate } from "@/api/taskTemplates";
import { toFormError } from "@/lib/formError";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** A task template: a ready title, description and report requirements to start a task from. */
export default function NewTemplateScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [req, setReq] = useState({ comment: true, photo: false, video: false, setsReps: false, duration: false, difficulty: false, wellbeing: false });
  const [errors, setErrors] = useState<{ title?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const flip = (key: keyof typeof req) => (value: boolean) => setReq((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!title.trim()) return setErrors({ title: "Укажите название шаблона." });
    setBusy(true);
    try {
      await createTemplate({
        title: title.trim(),
        description: description.trim() || null,
        plan_id: null,
        exercise_ids: [],
        metric_name: null,
        metric_unit: null,
        metric_target: null,
        require_comment: req.comment,
        require_photo: req.photo,
        require_video: req.video,
        require_sets_reps: req.setsReps,
        require_duration: req.duration,
        require_metric_value: false,
        require_difficulty: req.difficulty,
        require_wellbeing: req.wellbeing,
      });
      router.back();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Новый шаблон" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={title} onChangeText={setTitle} maxLength={200} error={errors.title} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
        <Card>
          <Text variant="heading">Что приложить к отчёту</Text>
          <SwitchRow label="Комментарий" value={req.comment} onChange={flip("comment")} />
          <SwitchRow label="Фото" value={req.photo} onChange={flip("photo")} />
          <SwitchRow label="Видео" value={req.video} onChange={flip("video")} />
          <SwitchRow label="Подходы и повторения" value={req.setsReps} onChange={flip("setsReps")} />
          <SwitchRow label="Длительность" value={req.duration} onChange={flip("duration")} />
          <SwitchRow label="Сложность (1–5)" value={req.difficulty} onChange={flip("difficulty")} />
          <SwitchRow label="Самочувствие (1–5)" value={req.wellbeing} onChange={flip("wellbeing")} />
        </Card>
        <Button title="Сохранить шаблон" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
