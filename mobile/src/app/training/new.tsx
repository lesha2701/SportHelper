import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { getAthleteBookingByTraining } from "@/api/bookings";
import { createPersonalTrainingDraft } from "@/api/ai";
import { createPersonalTraining, createTeamTraining, getTraining, updateTraining } from "@/api/trainings";
import { toFormError } from "@/lib/formError";
import { parseRuDate, parseTime, todayIso, formatRuDate } from "@/shared/lib/dates";
import { buildPersonalDescription, newRow, parseExerciseChecklist, rowsFromChecklist, type ExerciseKind, type ExerciseRow } from "@/shared/lib/trainingDescription";
import type { Booking } from "@/shared/types/booking";
import type { Training, TrainingCreateInput } from "@/shared/types/training";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { LoadingView } from "@/ui/StateViews";
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
  const { teamId: teamParam, id } = useLocalSearchParams<{ teamId?: string; id?: string }>();
  const toast = useToast();
  const editing = !!id;
  const [loaded, setLoaded] = useState<Training | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const teamId = teamParam ?? loaded?.teamId ?? undefined;
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

  const [aiBusy, setAiBusy] = useState(false);

  // Editing: fill the form from the saved training.
  useEffect(() => {
    if (!id) return;
    getTraining(id)
      .then(async (t) => {
        const linked = t.type === "personal" ? await getAthleteBookingByTraining(t.id) : null;
        setBooking(linked);
        setLoaded(t);
        setDate(formatRuDate(t.trainingDate));
        setTime(t.startTime.slice(0, 5));
        setDuration(String(t.durationMinutes));
        setLocation(t.location ?? "");
        setReminder(t.reminderMinutesBefore === null ? "none" : String(t.reminderMinutesBefore));
        if (t.teamId) setDescription(t.description ?? "");
        else {
          const list = t.description ? parseExerciseChecklist(t.description) : null;
          if (list) {
            setRows(rowsFromChecklist(list.items));
            setNotes(list.notes ?? "");
          } else {
            setRows([newRow()]);
            setNotes(t.description ?? "");
          }
        }
      })
      .catch((e: unknown) => setLoadError(toFormError(e).message));
  }, [id]);

  async function draftWithAi() {
    setAiBusy(true);
    setErrors({});
    try {
      const d = await createPersonalTrainingDraft({ style: "reps", goals: null, duration_minutes: parseInt(duration, 10) || null });
      setRows(
        d.exercises.map((e) => ({
          ...newRow(),
          exercise: e.exercise,
          kind: e.type,
          sets: e.sets ? String(e.sets) : "3",
          reps: e.reps ? String(e.reps) : "10",
          durationSeconds: e.durationSeconds ? String(e.durationSeconds) : "30",
          distanceMeters: e.distanceMeters ? String(e.distanceMeters) : "1000",
        })),
      );
      if (d.notes) setNotes(d.notes);
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    if (editing && (!loaded || loaded.id !== id)) return;
    if (booking && loaded) {
      setBusy(true);
      setErrors({});
      try {
        await updateTraining(loaded.id, {
          training_date: loaded.trainingDate,
          start_time: loaded.startTime,
          duration_minutes: loaded.durationMinutes,
          location: loaded.location,
          description: loaded.description,
          plan_id: loaded.planId,
          reminder_minutes_before: reminder === "none" ? null : Number(reminder),
          status: loaded.status,
          is_independent: false,
          responsible_user_id: loaded.responsibleUserId,
        });
        router.back();
      } catch (e) {
        setErrors({ form: toFormError(e).message });
      } finally {
        setBusy(false);
      }
      return;
    }
    const found: typeof errors = {};
    const iso = parseRuDate(date);
    const start = parseTime(time);
    const minutes = parseInt(duration, 10);
    const untilIso = until.trim() ? parseRuDate(until) : null;
    if (!iso) found.date = "Введите дату как ДД.ММ.ГГГГ.";
    if (!start) found.time = "Введите время как ЧЧ:ММ.";
    if (!(minutes >= 5 && minutes <= 600)) found.duration = "От 5 до 600 минут.";
    // Every exercise on the list needs a name (an unwanted row is removed with its button, not left empty).
    const missing = isTeam ? -1 : rows.findIndex((row) => !row.exercise.trim());
    if (missing >= 0) found.exercises = `Укажите название упражнения №${missing + 1}.`;
    if (until.trim() && (!untilIso || (iso && untilIso <= iso))) found.until = "Дата окончания повтора должна быть после первой тренировки.";
    setErrors(found);
    if (Object.keys(found).length) return;

    const description_ = (isTeam ? description.trim() : buildPersonalDescription(rows, notes)) || null;
    const input: TrainingCreateInput = {
      training_date: iso!,
      start_time: start!,
      duration_minutes: minutes,
      location: location.trim() || null,
      description: description_,
      plan_id: null,
      reminder_minutes_before: reminder === "none" ? null : Number(reminder),
      repeat_weekly_until: untilIso,
      is_independent: false,
      responsible_user_id: null,
    };
    setBusy(true);
    try {
      if (editing && loaded) {
        await updateTraining(loaded.id, {
          training_date: input.training_date,
          start_time: input.start_time,
          duration_minutes: input.duration_minutes,
          location: input.location,
          description: input.description,
          plan_id: loaded.planId,
          reminder_minutes_before: input.reminder_minutes_before,
          status: loaded.status,
          is_independent: loaded.type === "independent",
          responsible_user_id: loaded.responsibleUserId,
        });
        router.back();
        return;
      }
      const created = isTeam ? await createTeamTraining(teamId!, input) : await createPersonalTraining(input);
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
      <Stack.Screen options={{ headerShown: true, title: editing ? "Изменить тренировку" : isTeam ? "Тренировка команды" : "Личная тренировка" }} />
      <Screen header>
        {editing && loaded?.id !== id ? (
          loadError ? <Notice kind="danger">{loadError}</Notice> : <LoadingView />
        ) : (
          <>
            {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
            {booking && loaded ? (
              <Card>
                <Text variant="heading">Занятие с тренером {booking.coachFullName}</Text>
                <Text>{formatRuDate(loaded.trainingDate)} · {loaded.startTime.slice(0, 5)} · {loaded.durationMinutes} мин</Text>
                {loaded.location ? <Text>{loaded.location}</Text> : null}
                {loaded.description ? <Text>{loaded.description}</Text> : null}
                <Text muted>Здесь можно изменить напоминание. Отмена занятия доступна в карточке записи.</Text>
              </Card>
            ) : (
              <>
                  <DateField label="Дата" required value={date} onChange={setDate} error={errors.date} shortcuts />
                  <TimeField label="Начало" required value={time} onChange={setTime} error={errors.time} />
                  <TextField label="Длительность, мин" required value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} error={errors.duration} />
                  <TextField label="Место" value={location} onChangeText={setLocation} maxLength={200} />

                  {isTeam ? (
                    <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
                  ) : (
                    <View style={{ gap: 12 }}>
                      <Text variant="heading">Упражнения</Text>
                      <Button title="Предложить с ИИ" variant="secondary" onPress={draftWithAi} loading={aiBusy} />
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

              </>
            )}
            <Choice label="Напоминание" layout="chips" options={REMINDERS} value={reminder} onChange={setReminder} />
            {!editing ? <DateField label="Повторять каждую неделю до (необязательно)" value={until} onChange={setUntil} error={errors.until} /> : null}
            <Button title={editing ? "Сохранить" : "Создать"} onPress={submit} loading={busy} />
          </>
        )}
      </Screen>
    </>
  );
}
