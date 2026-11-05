import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { createPersonalTraining, createTeamTraining } from "@/api/trainings";
import { toFormError } from "@/lib/formError";
import { parseRuDate, parseTime, todayIso, formatRuDate } from "@/shared/lib/dates";
import { buildPersonalDescription, newRow, type ExerciseKind, type ExerciseRow } from "@/shared/lib/trainingDescription";
import type { TrainingCreateInput } from "@/shared/types/training";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

const REMINDERS = [
  { value: "none", title: "Без" },
  { value: "30", title: "За 30 мин" },
  { value: "60", title: "За 1 час" },
  { value: "120", title: "За 2 часа" },
  { value: "1440", title: "За день" },
];

const KINDS: { value: ExerciseKind; title: string }[] = [
  { value: "reps", title: "Повторения" },
  { value: "time", title: "Время" },
  { value: "distance", title: "Дистанция" },
];

function ExerciseRowEditor({ row, onChange, onRemove, error }: { row: ExerciseRow; onChange: (row: ExerciseRow) => void; onRemove: () => void; error?: string | null }) {
  const set = (patch: Partial<ExerciseRow>) => onChange({ ...row, ...patch });
  return (
    <Card>
      <TextField label="Упражнение" required value={row.exercise} onChangeText={(exercise) => set({ exercise })} maxLength={100} error={error} />
      <Choice layout="chips" options={KINDS} value={row.kind} onChange={(kind) => set({ kind })} />
      <TextField label="Подходов" value={row.sets} onChangeText={(sets) => set({ sets })} keyboardType="number-pad" maxLength={2} />
      {row.kind === "reps" ? <TextField label="Повторений" value={row.reps} onChangeText={(reps) => set({ reps })} keyboardType="number-pad" maxLength={3} /> : null}
      {row.kind === "time" ? <TextField label="Секунд" value={row.durationSeconds} onChangeText={(durationSeconds) => set({ durationSeconds })} keyboardType="number-pad" maxLength={4} /> : null}
      {row.kind === "distance" ? (
        <>
          <TextField label="Метров" value={row.distanceMeters} onChangeText={(distanceMeters) => set({ distanceMeters })} keyboardType="number-pad" maxLength={6} />
          <TextField label="Цель по времени, мин" value={row.timeMinutes} onChangeText={(timeMinutes) => set({ timeMinutes })} keyboardType="decimal-pad" maxLength={5} />
        </>
      ) : null}
      <Button title="Убрать упражнение" variant="ghost" onPress={onRemove} />
    </Card>
  );
}

/** A new training: of the team (when `teamId` is given, for coaches) or the person's own. */
export default function NewTrainingScreen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const toast = useToast();
  const isTeam = !!teamId;

  const [date, setDate] = useState(formatRuDate(todayIso()));
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState("90");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<ExerciseRow[]>([newRow()]);
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState("60");
  const [until, setUntil] = useState("");
  const [errors, setErrors] = useState<{ date?: string; time?: string; duration?: string; until?: string; exercises?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    const iso = parseRuDate(date);
    const start = parseTime(time);
    const minutes = parseInt(duration, 10);
    const untilIso = until.trim() ? parseRuDate(until) : null;
    if (!iso) found.date = "Введите дату как ДД.ММ.ГГГГ.";
    if (!start) found.time = "Введите время как ЧЧ:ММ.";
    if (!(minutes >= 5 && minutes <= 600)) found.duration = "От 5 до 600 минут.";
    // A personal training is a list of exercises: without at least one named exercise there is nothing to do.
    if (!isTeam && !rows.some((r) => r.exercise.trim())) found.exercises = "Укажите название хотя бы одного упражнения.";
    if (until.trim() && (!untilIso || (iso && untilIso <= iso))) found.until = "Дата окончания повтора должна быть после первой тренировки.";
    setErrors(found);
    if (Object.keys(found).length) return;

    const input: TrainingCreateInput = {
      training_date: iso!,
      start_time: start!,
      duration_minutes: minutes,
      location: location.trim() || null,
      description: (isTeam ? description.trim() : buildPersonalDescription(rows, notes)) || null,
      plan_id: null,
      reminder_minutes_before: reminder === "none" ? null : Number(reminder),
      repeat_weekly_until: untilIso,
      is_independent: false,
      responsible_user_id: null,
    };
    setBusy(true);
    try {
      const created = isTeam ? await createTeamTraining(teamId, input) : await createPersonalTraining(input);
      toast.success(created.length > 1 ? `Создано тренировок: ${created.length}` : "Тренировка создана");
      router.back();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: isTeam ? "Тренировка команды" : "Личная тренировка" }} />
      <Screen>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <DateField label="Дата" required value={date} onChange={setDate} error={errors.date} shortcuts />
        <TimeField label="Начало" required value={time} onChange={setTime} error={errors.time} />
        <TextField label="Длительность, мин" required value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} error={errors.duration} />
        <TextField label="Место" value={location} onChangeText={setLocation} maxLength={200} />

        {isTeam ? (
          <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
        ) : (
          <View style={{ gap: 12 }}>
            <Text variant="heading">Упражнения</Text>
            {rows.map((row, index) => (
              <ExerciseRowEditor
                key={index}
                row={row}
                onChange={(next) => {
                  setRows((current) => current.map((r, i) => (i === index ? next : r)));
                  if (errors.exercises) setErrors((current) => ({ ...current, exercises: undefined }));
                }}
                onRemove={() => setRows((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : [newRow()]))}
                error={errors.exercises && !row.exercise.trim() ? errors.exercises : null}
              />
            ))}
            <Button title="Добавить упражнение" variant="secondary" onPress={() => setRows((current) => [...current, newRow()])} />
            <TextField label="Пометки" value={notes} onChangeText={setNotes} multiline numberOfLines={3} maxLength={1000} />
          </View>
        )}

        <Choice label="Напоминание" layout="chips" options={REMINDERS} value={reminder} onChange={setReminder} />
        <DateField label="Повторять каждую неделю до (необязательно)" value={until} onChange={setUntil} error={errors.until} />
        <Button title="Создать" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
