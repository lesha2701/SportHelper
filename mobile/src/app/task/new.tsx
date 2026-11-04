import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { createTask } from "@/api/tasks";
import { listMembers } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { parseRuDate, parseTime } from "@/shared/lib/dates";
import type { TaskTargetType } from "@/shared/types/task";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Checkbox } from "@/ui/Checkbox";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const TARGETS: { value: TaskTargetType; title: string }[] = [
  { value: "team", title: "Вся команда" },
  { value: "players", title: "Выбранные игроки" },
];

export default function NewTaskScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const members = useLoad(() => listMembers(teamId), [teamId]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("23:59");
  const [target, setTarget] = useState<TaskTargetType>("team");
  const [picked, setPicked] = useState<string[]>([]);
  const [req, setReq] = useState({ comment: true, photo: false, video: false, setsReps: false, duration: false, difficulty: false, wellbeing: false });
  const [errors, setErrors] = useState<{ title?: string; date?: string; time?: string; players?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const players = (members.data ?? []).filter((m) => m.role !== "head_coach" && m.role !== "assistant_coach");
  const flip = (key: keyof typeof req) => (value: boolean) => setReq((current) => ({ ...current, [key]: value }));

  async function submit() {
    const found: typeof errors = {};
    const dateIso = date.trim() ? parseRuDate(date) : null;
    const timeValue = parseTime(time);
    if (!title.trim()) found.title = "Укажите название.";
    if (date.trim() && !dateIso) found.date = "Введите дату как ДД.ММ.ГГГГ.";
    if (date.trim() && !timeValue) found.time = "Введите время как ЧЧ:ММ.";
    if (target === "players" && picked.length === 0) found.players = "Выберите хотя бы одного игрока.";
    setErrors(found);
    if (Object.keys(found).length) return;

    const deadline = dateIso && timeValue ? new Date(`${dateIso}T${timeValue}:00`).toISOString() : null;
    setBusy(true);
    try {
      await createTask(teamId, {
        title: title.trim(),
        description: description.trim() || null,
        plan_id: null,
        exercise_ids: [],
        deadline,
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
        target_type: target,
        player_ids: target === "players" ? picked : [],
        position: null,
        training_id: null,
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
      <Stack.Screen options={{ headerShown: true, title: "Новое задание" }} />
      <Screen>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={title} onChangeText={setTitle} maxLength={200} error={errors.title} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
        <DateField label="Срок (необязательно)" value={date} onChange={setDate} error={errors.date} shortcuts />
        {date.trim() ? <TimeField label="Время срока" value={time} onChange={setTime} error={errors.time} /> : null}
        <Choice label="Кому" layout="chips" options={TARGETS} value={target} onChange={setTarget} />
        {target === "players" ? (
          <Card>
            {players.map((m) => (
              <Checkbox
                key={m.userId}
                checked={picked.includes(m.userId)}
                onChange={(on) => setPicked((current) => (on ? [...current, m.userId] : current.filter((id) => id !== m.userId)))}
              >
                <Text>{[m.firstName, m.lastName].filter(Boolean).join(" ")}</Text>
              </Checkbox>
            ))}
            {errors.players ? <Text variant="caption" style={{ color: "#e85d2a" }}>{errors.players}</Text> : null}
          </Card>
        ) : null}
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
        <Button title="Создать задание" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
