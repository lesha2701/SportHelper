import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { saveTrainingWorkout } from "@/api/trainings";
import { toFormError } from "@/lib/formError";
import { count } from "@/shared/lib/plural";
import {
  buildWorkoutExercises,
  describePlan,
  describeSets,
  formatClock,
  formatKg,
  formatMeters,
  meterStep,
  newSet,
  parseClock,
  workoutTotals,
} from "@/shared/lib/workout";
import type { TrainingWorkout, WorkoutExercise, WorkoutMetric, WorkoutSet } from "@/shared/types/training";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { clearDraft, writeDraft, type Draft } from "./drafts";

const REST_OPTIONS = [
  { seconds: 0, label: "Без" },
  { seconds: 30, label: "30 с" },
  { seconds: 60, label: "1 мин" },
  { seconds: 90, label: "1:30" },
  { seconds: 120, label: "2 мин" },
];
/** One tap of + / - on the time of a timed set. */
const TIME_STEP_SECONDS = 5;

type Phase = "workout" | "summary" | "saved";

/** A running stopwatch on one set of a timed exercise. */
interface Timing {
  setIndex: number;
  from: number;
}

const HEAD_LABELS: Record<WorkoutMetric, [string, string]> = {
  reps: ["Повторения", "Вес, кг"],
  time: ["Время", "Секундомер"],
  distance: ["Расстояние, м", "Время"],
};

function Stepper({ label, onMinus, onPlus, disabled, children }: { label: string; onMinus: () => void; onPlus: () => void; disabled?: boolean; children: React.ReactNode }) {
  const { colors } = useTheme();
  const button = [styles.stepButton, { borderColor: colors.borderStrong, backgroundColor: colors.surface }];
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityLabel={`Меньше: ${label}`} disabled={disabled} onPress={onMinus} style={button}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      {children}
      <Pressable accessibilityLabel={`Больше: ${label}`} disabled={disabled} onPress={onPlus} style={button}>
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

function NumberBox({ value, onChange, label, decimal, placeholder, width = 52, max }: { value: number | null; onChange: (value: number | null) => void; label: string; decimal?: boolean; placeholder?: string; width?: number; max: number }) {
  const { colors } = useTheme();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? "" : String(value));
  }, [value, focused]);
  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      keyboardType={decimal ? "decimal-pad" : "number-pad"}
      onFocus={() => setFocused(true)}
      onChangeText={(next) => {
        setText(next);
        const n = Number(next.replace(",", "."));
        // The server refuses values beyond its limits, so the field never lets one in.
        onChange(next.trim() === "" ? null : Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : value);
      }}
      onBlur={() => setFocused(false)}
      style={[styles.numberBox, { width, color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surface }]}
    />
  );
}

/** A time typed as "мм:сс" (or plain seconds); applied when the field is left, so typing is never fought. */
function ClockInput({ seconds, onChange, label }: { seconds: number | null; onChange: (seconds: number | null) => void; label: string }) {
  const { colors } = useTheme();
  const [text, setText] = useState(seconds === null ? "" : formatClock(seconds));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(seconds === null ? "" : formatClock(seconds));
  }, [seconds, focused]);
  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      placeholder="м:сс"
      placeholderTextColor={colors.textTertiary}
      keyboardType="numbers-and-punctuation"
      onFocus={() => setFocused(true)}
      onChangeText={setText}
      onBlur={() => {
        setFocused(false);
        onChange(text.trim() === "" ? null : parseClock(text));
      }}
      style={[styles.numberBox, { width: 72, color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surface }]}
    />
  );
}

/** The guided workout: one exercise at a time, each set counted the way the exercise is measured (repetitions with a
 * weight, time, or distance), a rest timer between sets, and a summary saved with the training. The unfinished
 * workout is kept on the device, so a closed app or a locked phone never loses it. */
export function WorkoutSession({
  trainingId,
  items,
  notes,
  initialDraft,
  onExit,
  onSaved,
}: {
  trainingId: string;
  items: { text: string }[];
  notes: string | null;
  initialDraft: Draft | null;
  onExit: () => void;
  onSaved: (workout: TrainingWorkout) => void;
}) {
  const { colors } = useTheme();
  const [initial] = useState<Draft>(
    () => initialDraft ?? { exercises: buildWorkoutExercises(items), activeIndex: 0, startedAt: Date.now(), restSeconds: 60 },
  );
  const [exercises, setExercises] = useState<WorkoutExercise[]>(initial.exercises);
  const [activeIndex, setActiveIndex] = useState(initial.activeIndex);
  const [restSeconds, setRestSeconds] = useState(initial.restSeconds);
  const startedAt = initial.startedAt;

  const [phase, setPhase] = useState<Phase>("workout");
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "saved") return;
    void writeDraft(trainingId, { exercises, activeIndex, startedAt, restSeconds });
  }, [trainingId, exercises, activeIndex, startedAt, restSeconds, phase]);

  // A wall-clock tick (not a counter), so the clocks stay right when the screen was locked for a while.
  useEffect(() => {
    if (phase !== "workout") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (restEndsAt !== null && now >= restEndsAt) {
      setRestEndsAt(null);
      Vibration.vibrate(300);
    }
  }, [now, restEndsAt]);

  const totals = useMemo(() => workoutTotals(exercises), [exercises]);
  const exercise = exercises[activeIndex]!;
  const metric = exercise.metric;
  const isLast = activeIndex === exercises.length - 1;
  const restLeft = restEndsAt === null ? 0 : Math.max(0, Math.ceil((restEndsAt - now) / 1000));
  const elapsed = Math.floor(((finishedAt ?? now) - startedAt) / 1000);

  const changeExercise = useCallback((index: number, change: (e: WorkoutExercise) => WorkoutExercise) => {
    setExercises((current) => current.map((e, i) => (i === index ? change(e) : e)));
  }, []);
  const changeSet = (setIndex: number, patch: Partial<WorkoutSet>) =>
    changeExercise(activeIndex, (e) => ({ ...e, sets: e.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s)) }));

  const startRest = () => {
    setNow(Date.now());
    setRestEndsAt(Date.now() + restSeconds * 1000);
  };

  const toggleDone = (setIndex: number) => {
    const set = exercise.sets[setIndex]!;
    const becomesDone = !set.done;
    if (timing?.setIndex === setIndex) setTiming(null);
    changeExercise(activeIndex, (e) => ({
      ...e,
      sets: e.sets.map((s, i) => {
        if (i === setIndex) return { ...s, done: becomesDone };
        // The weight carries over to the next set that has none yet, so it is typed once.
        if (becomesDone && e.metric === "reps" && i > setIndex && !s.done && s.weightKg === null && set.weightKg !== null) return { ...s, weightKg: set.weightKg };
        return s;
      }),
    }));
    if (becomesDone && restSeconds > 0 && totals.setsDone + 1 < totals.setsTotal) startRest();
    if (!becomesDone) setRestEndsAt(null);
  };

  /** The stopwatch of a timed set: the first tap starts it, the second stops it, records the time and marks the set done. */
  const toggleStopwatch = (setIndex: number) => {
    if (timing?.setIndex === setIndex) {
      const seconds = Math.max(1, Math.round((Date.now() - timing.from) / 1000));
      setTiming(null);
      changeSet(setIndex, { seconds, done: true });
      if (restSeconds > 0 && totals.setsDone + 1 < totals.setsTotal) startRest();
      return;
    }
    setRestEndsAt(null);
    setTiming({ setIndex, from: Date.now() });
  };

  const addSet = () =>
    changeExercise(activeIndex, (e) => {
      const last = e.sets[e.sets.length - 1];
      const fresh = newSet(e.metric, { reps: last?.reps ?? e.targetReps, seconds: last?.seconds ?? e.targetSeconds, meters: last?.meters ?? e.targetMeters });
      return { ...e, sets: [...e.sets, { ...fresh, weightKg: last?.weightKg ?? null }] };
    });
  const removeLastSet = () => changeExercise(activeIndex, (e) => ({ ...e, sets: e.sets.slice(0, -1) }));

  // Moving to another exercise ends the rest and any stopwatch: they belonged to the exercise just left.
  const goTo = (index: number) => {
    setActiveIndex(index);
    setRestEndsAt(null);
    setTiming(null);
  };

  const finish = () => {
    setFinishedAt(Date.now());
    setRestEndsAt(null);
    setTiming(null);
    setPhase("summary");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTrainingWorkout(trainingId, {
        exercises,
        wellbeing: null,
        note: null,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt ?? Date.now()).toISOString(),
      });
      await clearDraft(trainingId);
      setPhase("saved");
      onSaved(saved);
    } catch (e) {
      setError(`${toFormError(e).message} Результат остаётся на этом устройстве, попробуйте ещё раз.`);
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    await clearDraft(trainingId);
    onExit();
  };

  const frame = (children: React.ReactNode) => <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>{children}</SafeAreaView>;

  if (phase === "saved") {
    return frame(
      <View style={styles.doneBox}>
        <Text variant="title">Тренировка записана</Text>
        <Text muted>
          {count(totals.setsDone, "подход", "подхода", "подходов")} за {formatClock(elapsed)}
        </Text>
        <Button title="Готово" onPress={onExit} style={{ alignSelf: "stretch" }} />
      </View>,
    );
  }

  if (phase === "summary") {
    const tile = (value: string, label: string) => (
      <View key={label} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="heading">{value}</Text>
        <Text variant="caption" muted>
          {label}
        </Text>
      </View>
    );
    return frame(
      <>
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="title">Итоги</Text>
          <View style={styles.tiles}>
            {tile(formatClock(elapsed), "время")}
            {tile(`${totals.setsDone}/${totals.setsTotal}`, "подходов")}
            {totals.reps > 0 ? tile(String(totals.reps), "повторений") : null}
            {totals.volumeKg > 0 ? tile(formatKg(totals.volumeKg).replace(" кг", ""), "кг тоннаж") : null}
            {totals.seconds > 0 ? tile(formatClock(totals.seconds), "под нагрузкой") : null}
            {totals.meters > 0 ? tile(formatMeters(totals.meters).replace(/ (км|м)$/, ""), totals.meters >= 1000 ? "км дистанция" : "м дистанция") : null}
          </View>
          {exercises.map((e, index) => (
            <View key={index} style={{ gap: 2 }}>
              <Text variant="label">{e.name}</Text>
              <Text muted>{describeSets(e) || "не выполнено"}</Text>
            </View>
          ))}
          {error ? <Notice kind="danger">{error}</Notice> : null}
        </ScrollView>
        <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <Button title={saving ? "Сохраняем…" : "Сохранить результат"} onPress={save} loading={saving} disabled={totals.setsDone === 0} />
          {totals.setsDone === 0 ? <Text variant="caption" muted>Отметьте хотя бы один выполненный подход, чтобы сохранить результат.</Text> : null}
          <Button title="Вернуться к тренировке" variant="secondary" onPress={() => setPhase("workout")} />
          <Button title="Не сохранять" variant="ghost" onPress={() => void discard()} />
        </View>
      </>,
    );
  }

  const exerciseDone = exercise.sets.length > 0 && exercise.sets.every((s) => s.done);
  const setsProgress = totals.setsTotal === 0 ? 0 : (totals.setsDone / totals.setsTotal) * 100;
  const liveSeconds = (set: WorkoutSet, setIndex: number) => (timing?.setIndex === setIndex ? Math.floor((now - timing.from) / 1000) : (set.seconds ?? 0));
  const planText = describePlan(exercise);
  const distanceStep = meterStep(exercise);

  return frame(
    <>
      <View style={styles.top}>
        <View style={styles.topSide}>
          <Pressable accessibilityLabel="Выйти, прогресс сохранится на этом устройстве" onPress={onExit} hitSlop={10}>
            <Text variant="heading">‹</Text>
          </Pressable>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text variant="heading">{formatClock(elapsed)}</Text>
          <Text variant="caption" muted>
            подходов {totals.setsDone} из {totals.setsTotal}
          </Text>
        </View>
        <View style={[styles.topSide, { alignItems: "flex-end" }]}>
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={10}>
            <Text variant="label" style={{ color: colors.primary }}>Завершить</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.progress, { backgroundColor: colors.surfaceAlt }]}>
        <View style={{ width: `${setsProgress}%`, height: 4, backgroundColor: colors.primary }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.chips}>
          {exercises.map((e, index) => {
            const done = e.sets.length > 0 && e.sets.every((s) => s.done);
            const active = index === activeIndex;
            return (
              <Pressable
                key={index}
                accessibilityLabel={`Упражнение ${index + 1}`}
                onPress={() => goTo(index)}
                style={[styles.chip, { borderColor: active ? colors.primary : colors.borderStrong, backgroundColor: done ? colors.success : active ? colors.primaryGlow : colors.surface }]}
              >
                <Text variant="label" style={{ color: done ? "#fff" : colors.text }}>{done ? "✓" : index + 1}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text variant="caption" muted>
          Упражнение {activeIndex + 1} из {exercises.length}
        </Text>
        <Text variant="title">{exercise.name}</Text>
        {planText ? <Text muted>План: {planText}</Text> : null}

        <View style={styles.setsHead}>
          <Text variant="caption" muted style={{ width: 24 }}>№</Text>
          <Text variant="caption" muted style={{ flex: 1 }}>{HEAD_LABELS[metric][0]}</Text>
          <Text variant="caption" muted style={{ width: 84 }}>{HEAD_LABELS[metric][1]}</Text>
          <View style={{ width: 44 }} />
        </View>

        {exercise.sets.map((set, setIndex) => {
          const running = timing?.setIndex === setIndex;
          return (
            <View key={setIndex} style={[styles.setRow, { borderColor: set.done ? colors.success : colors.border, backgroundColor: set.done ? colors.successBg : colors.surface }]}>
              <Text variant="label" style={{ width: 24 }}>{setIndex + 1}</Text>

              {metric === "reps" ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Stepper label="повторения" onMinus={() => changeSet(setIndex, { reps: Math.max(0, set.reps - 1) })} onPlus={() => changeSet(setIndex, { reps: set.reps + 1 })}>
                      <NumberBox label={`Повторения, подход ${setIndex + 1}`} max={10000} value={set.reps} onChange={(v) => changeSet(setIndex, { reps: Math.floor(v ?? 0) })} />
                    </Stepper>
                  </View>
                  <NumberBox label={`Вес, кг, подход ${setIndex + 1}`} max={2000} decimal placeholder="—" width={84} value={set.weightKg} onChange={(v) => changeSet(setIndex, { weightKg: v })} />
                </>
              ) : null}

              {metric === "time" ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Stepper
                      label="время"
                      disabled={running}
                      onMinus={() => changeSet(setIndex, { seconds: Math.max(0, (set.seconds ?? 0) - TIME_STEP_SECONDS) })}
                      onPlus={() => changeSet(setIndex, { seconds: (set.seconds ?? 0) + TIME_STEP_SECONDS })}
                    >
                      <Text variant="label" style={{ minWidth: 52, textAlign: "center", color: running ? colors.primary : colors.text }}>{formatClock(liveSeconds(set, setIndex))}</Text>
                    </Stepper>
                  </View>
                  <Pressable
                    accessibilityLabel={running ? "Остановить секундомер" : "Запустить секундомер"}
                    onPress={() => toggleStopwatch(setIndex)}
                    style={[styles.stopwatch, { backgroundColor: running ? colors.primary : colors.surfaceAlt }]}
                  >
                    <Text variant="label" style={{ color: running ? "#fff" : colors.text }}>{running ? "■" : "▶"}</Text>
                  </Pressable>
                </>
              ) : null}

              {metric === "distance" ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Stepper
                      label="расстояние"
                      onMinus={() => changeSet(setIndex, { meters: Math.max(0, Math.round(((set.meters ?? 0) - distanceStep) * 10) / 10) })}
                      onPlus={() => changeSet(setIndex, { meters: Math.round(((set.meters ?? 0) + distanceStep) * 10) / 10 })}
                    >
                      <NumberBox label={`Расстояние, м, подход ${setIndex + 1}`} max={1000000} decimal width={64} value={set.meters} onChange={(v) => changeSet(setIndex, { meters: v })} />
                    </Stepper>
                  </View>
                  <ClockInput label={`Время, подход ${setIndex + 1}`} seconds={set.seconds} onChange={(seconds) => changeSet(setIndex, { seconds })} />
                </>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: set.done }}
                accessibilityLabel={set.done ? `Подход ${setIndex + 1} выполнен, отменить` : `Отметить подход ${setIndex + 1} выполненным`}
                onPress={() => toggleDone(setIndex)}
                style={[styles.doneButton, { backgroundColor: set.done ? colors.success : colors.surfaceAlt }]}
              >
                <Text variant="label" style={{ color: set.done ? "#fff" : colors.textTertiary }}>✓</Text>
              </Pressable>
            </View>
          );
        })}

        <View style={styles.row}>
          <Button title="+ Подход" variant="secondary" onPress={addSet} style={{ flex: 1 }} />
          {exercise.sets.length > 1 && !exercise.sets[exercise.sets.length - 1]!.done ? (
            <Button title="− Подход" variant="secondary" onPress={removeLastSet} style={{ flex: 1 }} />
          ) : null}
        </View>

        <Text variant="label" muted>Отдых между подходами</Text>
        <View style={styles.chips}>
          {REST_OPTIONS.map((option) => {
            const on = restSeconds === option.seconds;
            return (
              <Pressable
                key={option.seconds}
                onPress={() => setRestSeconds(option.seconds)}
                style={[styles.restChoice, { borderColor: on ? colors.primary : colors.borderStrong, backgroundColor: on ? colors.primaryGlow : colors.surface }]}
              >
                <Text variant="label" style={on ? { color: colors.primary } : undefined}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {notes ? <Text muted>Пометки: {notes}</Text> : null}
      </ScrollView>

      <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        {restEndsAt !== null ? (
          <View style={styles.row} accessibilityRole="timer">
            <Text variant="label">Отдых</Text>
            <Text variant="heading" style={{ flex: 1 }}>{formatClock(restLeft)}</Text>
            <Button title="+15 с" variant="secondary" onPress={() => setRestEndsAt((t) => (t === null ? t : t + 15000))} />
            <Button title="Пропустить" variant="secondary" onPress={() => setRestEndsAt(null)} />
          </View>
        ) : null}
        {isLast ? (
          <Button title="Завершить тренировку" onPress={finish} />
        ) : (
          <>
            <Button title="Следующее упражнение" variant={exerciseDone ? "primary" : "secondary"} onPress={() => goTo(activeIndex + 1)} />
            <Button title="Завершить тренировку" variant="ghost" onPress={finish} />
          </>
        )}
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  topSide: { width: 96, justifyContent: "center" },
  progress: { height: 4 },
  content: { padding: 20, gap: 14, width: "100%", maxWidth: 560, alignSelf: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  setsHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  setRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: radius.md, padding: 8 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepButton: { width: 36, height: 40, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  stepText: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 22 },
  numberBox: { height: 40, borderWidth: 1, borderRadius: radius.md, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 15, paddingHorizontal: 4 },
  stopwatch: { width: 84, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  doneButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  restChoice: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  bar: { padding: 16, gap: 10, borderTopWidth: 1 },
  doneBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { minWidth: 96, borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 2 },
});
