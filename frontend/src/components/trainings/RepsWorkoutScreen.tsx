import { useCallback, useEffect, useMemo, useState } from "react";
import { saveTrainingWorkout } from "../../api/trainings";
import { ApiError } from "../../api/client";
import { count } from "../../lib/plural";
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
} from "../../lib/workout";
import type { TrainingWorkout, WorkoutExercise, WorkoutMetric, WorkoutSet } from "../../types/training";
import { Icon } from "../shared/Icon";
import profileStyles from "../profile/profile.module.css";
import styles from "./workout.module.css";

const REST_OPTIONS = [
  { seconds: 0, label: "Без" },
  { seconds: 30, label: "30 с" },
  { seconds: 60, label: "1 мин" },
  { seconds: 90, label: "1:30" },
  { seconds: 120, label: "2 мин" },
];
/** One tap of + / - on the time of a timed set. */
const TIME_STEP_SECONDS = 5;
const DRAFT_PREFIX = "sag-workout-draft:";

interface Draft {
  exercises: WorkoutExercise[];
  activeIndex: number;
  startedAt: number;
  restSeconds: number;
}

/** A draft saved by an older version has no metric on its exercises: they were all repetitions. */
function normalizeExercises(exercises: WorkoutExercise[]): WorkoutExercise[] {
  return exercises.map((e) => ({
    ...e,
    metric: e.metric ?? "reps",
    sets: e.sets.map((s) => ({ ...s, seconds: s.seconds ?? null, meters: s.meters ?? null })),
  }));
}

function readDraft(trainingId: string, itemCount: number): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + trainingId);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (!Array.isArray(draft.exercises) || draft.exercises.length !== itemCount) return null;
    return { ...draft, exercises: normalizeExercises(draft.exercises) };
  } catch {
    return null;
  }
}

function writeDraft(trainingId: string, draft: Draft): void {
  try {
    window.localStorage.setItem(DRAFT_PREFIX + trainingId, JSON.stringify(draft));
  } catch {
    /* storage is full or blocked: the workout just cannot be resumed after a reload */
  }
}

function clearDraft(trainingId: string): void {
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + trainingId);
  } catch {
    /* nothing to clear */
  }
}

/** True when a workout was started on this device and not finished or saved yet. */
export function hasWorkoutDraft(trainingId: string): boolean {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + trainingId) !== null;
  } catch {
    return false;
  }
}

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

/** A time typed as "мм:сс" (or plain seconds); it is applied when the field is left, so typing is never fought. */
function ClockInput({ seconds, onChange, label }: { seconds: number | null; onChange: (seconds: number | null) => void; label: string }) {
  const [text, setText] = useState(seconds === null ? "" : formatClock(seconds));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(seconds === null ? "" : formatClock(seconds));
  }, [seconds, focused]);
  return (
    <input
      className={styles.weightInput}
      type="text"
      inputMode="numeric"
      placeholder="м:сс"
      aria-label={label}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseClock(text);
        onChange(text.trim() === "" ? null : parsed);
      }}
    />
  );
}

/** The guided workout: one exercise at a time, each set counted the way the exercise is measured (repetitions with a
 * weight, time, or distance), a rest timer between sets, and a summary that is saved with the training. The unfinished
 * workout is kept on the device, so a reload or a locked phone never loses it. */
export function RepsWorkoutScreen({
  token,
  trainingId,
  items,
  notes,
  onExit,
  onSaved,
}: {
  token: string;
  trainingId: string;
  items: { text: string }[];
  notes: string | null;
  onExit: () => void;
  onSaved: (workout: TrainingWorkout) => void;
}) {
  const [initial] = useState<Draft>(
    () =>
      readDraft(trainingId, items.length) ?? {
        exercises: buildWorkoutExercises(items),
        activeIndex: 0,
        startedAt: Date.now(),
        restSeconds: 60,
      },
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
    writeDraft(trainingId, { exercises, activeIndex, startedAt, restSeconds });
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
      try {
        navigator.vibrate?.(200);
      } catch {
        /* not supported */
      }
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
      const saved = await saveTrainingWorkout(token, trainingId, {
        exercises,
        wellbeing: null,
        note: null,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt ?? Date.now()).toISOString(),
      });
      clearDraft(trainingId);
      setPhase("saved");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить результат. Он остаётся на этом устройстве — попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    clearDraft(trainingId);
    onExit();
  };

  if (phase === "saved") {
    return (
      <div className={styles.screen}>
        <div className={styles.doneBox}>
          <Icon name="check-circle" size={56} />
          <h1 className={styles.doneTitle}>Тренировка записана</h1>
          <p className={styles.doneText}>
            {count(totals.setsDone, "подход", "подхода", "подходов")} за {formatClock(elapsed)}
          </p>
          <button type="button" className={profileStyles.buttonPrimary} style={{ maxWidth: 320 }} onClick={onExit}>
            Готово
          </button>
        </div>
      </div>
    );
  }

  if (phase === "summary") {
    return (
      <div className={styles.screen}>
        <header className={styles.top}>
          <button type="button" className={styles.iconButton} onClick={() => setPhase("workout")} aria-label="Вернуться к тренировке">
            <Icon name="chevron-left" size={20} />
          </button>
          <h1 className={styles.topTitle}>Итоги</h1>
          <span />
        </header>

        <div className={styles.content}>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileValue}>{formatClock(elapsed)}</span>
              <span className={styles.tileLabel}>время</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileValue}>
                {totals.setsDone}/{totals.setsTotal}
              </span>
              <span className={styles.tileLabel}>подходов</span>
            </div>
            {totals.reps > 0 && (
              <div className={styles.tile}>
                <span className={styles.tileValue}>{totals.reps}</span>
                <span className={styles.tileLabel}>повторений</span>
              </div>
            )}
            {totals.volumeKg > 0 && (
              <div className={styles.tile}>
                <span className={styles.tileValue}>{formatKg(totals.volumeKg).replace(" кг", "")}</span>
                <span className={styles.tileLabel}>кг тоннаж</span>
              </div>
            )}
            {totals.seconds > 0 && (
              <div className={styles.tile}>
                <span className={styles.tileValue}>{formatClock(totals.seconds)}</span>
                <span className={styles.tileLabel}>под нагрузкой</span>
              </div>
            )}
            {totals.meters > 0 && (
              <div className={styles.tile}>
                <span className={styles.tileValue}>{formatMeters(totals.meters).replace(/ (км|м)$/, "")}</span>
                <span className={styles.tileLabel}>{totals.meters >= 1000 ? "км" : "м"} дистанция</span>
              </div>
            )}
          </div>

          <ul className={styles.recap}>
            {exercises.map((e, index) => (
              <li key={index} className={styles.recapRow}>
                <span className={styles.recapName}>{e.name}</span>
                <span className={styles.recapSets}>{describeSets(e) || "не выполнено"}</span>
              </li>
            ))}
          </ul>

          {error && <p className={profileStyles.error}>{error}</p>}
        </div>

        <footer className={styles.bar}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={save} disabled={saving || totals.setsDone === 0}>
            {saving ? "Сохраняем…" : "Сохранить результат"}
          </button>
          {totals.setsDone === 0 && <p className={styles.hint}>Отметьте хотя бы один выполненный подход, чтобы сохранить результат.</p>}
          <button type="button" className={styles.linkButton} onClick={discard}>
            Не сохранять
          </button>
        </footer>
      </div>
    );
  }

  const exerciseDone = exercise.sets.length > 0 && exercise.sets.every((s) => s.done);
  const setsProgress = totals.setsTotal === 0 ? 0 : (totals.setsDone / totals.setsTotal) * 100;
  const liveSeconds = (set: WorkoutSet, setIndex: number) => (timing?.setIndex === setIndex ? Math.floor((now - timing.from) / 1000) : (set.seconds ?? 0));
  const planText = describePlan(exercise);
  const distanceStep = meterStep(exercise);

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <button type="button" className={styles.iconButton} onClick={onExit} aria-label="Выйти, прогресс сохранится на этом устройстве">
          <Icon name="chevron-left" size={20} />
        </button>
        <div className={styles.topTitle}>
          <span className={styles.clock}>{formatClock(elapsed)}</span>
          <span className={styles.topSub}>
            подходов {totals.setsDone} из {totals.setsTotal}
          </span>
        </div>
        <button type="button" className={styles.finishButton} onClick={finish}>
          Завершить
        </button>
      </header>
      <div className={styles.progress} aria-hidden="true">
        <span style={{ width: `${setsProgress}%` }} />
      </div>

      <nav className={styles.chips} aria-label="Упражнения">
        {exercises.map((e, index) => {
          const done = e.sets.length > 0 && e.sets.every((s) => s.done);
          const className = [styles.chip, index === activeIndex ? styles.chipActive : "", done ? styles.chipDone : ""].join(" ");
          return (
            <button key={index} type="button" className={className} onClick={() => goTo(index)} aria-current={index === activeIndex ? "step" : undefined}>
              {done ? <Icon name="check" size={14} strokeWidth={3} /> : index + 1}
            </button>
          );
        })}
      </nav>

      <div className={styles.content}>
        <span className={styles.step}>
          Упражнение {activeIndex + 1} из {exercises.length}
        </span>
        <h1 className={styles.exerciseName}>{exercise.name}</h1>
        {planText && <p className={styles.target}>План: {planText}</p>}

        <ul className={styles.sets}>
          <li className={styles.setsHead} aria-hidden="true">
            <span>№</span>
            <span>{HEAD_LABELS[metric][0]}</span>
            <span>{HEAD_LABELS[metric][1]}</span>
            <span />
          </li>
          {exercise.sets.map((set, setIndex) => {
            const running = timing?.setIndex === setIndex;
            return (
              <li key={setIndex} className={set.done ? `${styles.setRow} ${styles.setRowDone}` : styles.setRow}>
                <span className={styles.setNumber}>{setIndex + 1}</span>

                {metric === "reps" && (
                  <>
                    <div className={styles.stepper}>
                      <button type="button" className={styles.stepButton} aria-label="Меньше повторений" onClick={() => changeSet(setIndex, { reps: Math.max(0, set.reps - 1) })}>
                        −
                      </button>
                      <input
                        className={styles.repsInput}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        aria-label={`Повторения, подход ${setIndex + 1}`}
                        value={set.reps}
                        onChange={(e) => changeSet(setIndex, { reps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value) || 0))) })}
                      />
                      <button type="button" className={styles.stepButton} aria-label="Больше повторений" onClick={() => changeSet(setIndex, { reps: set.reps + 1 })}>
                        +
                      </button>
                    </div>
                    <input
                      className={styles.weightInput}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      placeholder="—"
                      aria-label={`Вес, кг, подход ${setIndex + 1}`}
                      value={set.weightKg ?? ""}
                      onChange={(e) => changeSet(setIndex, { weightKg: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    />
                  </>
                )}

                {metric === "time" && (
                  <>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.stepButton}
                        aria-label="Меньше времени"
                        disabled={running}
                        onClick={() => changeSet(setIndex, { seconds: Math.max(0, (set.seconds ?? 0) - TIME_STEP_SECONDS) })}
                      >
                        −
                      </button>
                      <span className={running ? `${styles.timeValue} ${styles.timeValueRunning}` : styles.timeValue} aria-label={`Время, подход ${setIndex + 1}`}>
                        {formatClock(liveSeconds(set, setIndex))}
                      </span>
                      <button
                        type="button"
                        className={styles.stepButton}
                        aria-label="Больше времени"
                        disabled={running}
                        onClick={() => changeSet(setIndex, { seconds: (set.seconds ?? 0) + TIME_STEP_SECONDS })}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className={running ? `${styles.stopwatch} ${styles.stopwatchOn}` : styles.stopwatch}
                      aria-label={running ? "Остановить секундомер" : "Запустить секундомер"}
                      onClick={() => toggleStopwatch(setIndex)}
                    >
                      {running ? "■" : "▶"}
                    </button>
                  </>
                )}

                {metric === "distance" && (
                  <>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.stepButton}
                        aria-label="Меньше"
                        onClick={() => changeSet(setIndex, { meters: Math.max(0, Math.round(((set.meters ?? 0) - distanceStep) * 10) / 10) })}
                      >
                        −
                      </button>
                      <input
                        className={styles.repsInput}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={distanceStep}
                        aria-label={`Расстояние, м, подход ${setIndex + 1}`}
                        value={set.meters ?? ""}
                        onChange={(e) => changeSet(setIndex, { meters: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                      />
                      <button
                        type="button"
                        className={styles.stepButton}
                        aria-label="Больше"
                        onClick={() => changeSet(setIndex, { meters: Math.round(((set.meters ?? 0) + distanceStep) * 10) / 10 })}
                      >
                        +
                      </button>
                    </div>
                    <ClockInput seconds={set.seconds} label={`Время, подход ${setIndex + 1}`} onChange={(seconds) => changeSet(setIndex, { seconds })} />
                  </>
                )}

                <button
                  type="button"
                  className={set.done ? `${styles.doneButton} ${styles.doneButtonOn}` : styles.doneButton}
                  aria-pressed={set.done}
                  aria-label={set.done ? `Подход ${setIndex + 1} выполнен, отменить` : `Отметить подход ${setIndex + 1} выполненным`}
                  onClick={() => toggleDone(setIndex)}
                >
                  <Icon name="check" size={20} strokeWidth={3} />
                </button>
              </li>
            );
          })}
        </ul>

        <div className={styles.setActions}>
          <button type="button" className={styles.softButton} onClick={addSet}>
            <Icon name="plus" size={15} />
            Подход
          </button>
          {exercise.sets.length > 1 && !exercise.sets[exercise.sets.length - 1]!.done && (
            <button type="button" className={styles.softButton} onClick={removeLastSet}>
              Убрать последний
            </button>
          )}
        </div>

        <section className={styles.restSetting}>
          <span className={styles.restLabel}>Отдых между подходами</span>
          <div className={styles.restChoices}>
            {REST_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                type="button"
                className={restSeconds === option.seconds ? `${styles.restChoice} ${styles.restChoiceOn}` : styles.restChoice}
                onClick={() => setRestSeconds(option.seconds)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {notes && <p className={styles.notes}>Пометки: {notes}</p>}
      </div>

      <footer className={styles.bar}>
        {restEndsAt !== null && (
          <div className={styles.rest} role="timer" aria-live="off">
            <span className={styles.restTitle}>Отдых</span>
            <strong className={styles.restTime}>{formatClock(restLeft)}</strong>
            <button type="button" className={styles.softButton} onClick={() => setRestEndsAt((t) => (t === null ? t : t + 15000))}>
              +15 с
            </button>
            <button type="button" className={styles.softButton} onClick={() => setRestEndsAt(null)}>
              Пропустить
            </button>
          </div>
        )}
        {isLast ? (
          <button type="button" className={profileStyles.buttonPrimary} onClick={finish}>
            Завершить тренировку
          </button>
        ) : (
          <button
            type="button"
            className={exerciseDone ? profileStyles.buttonPrimary : profileStyles.buttonSecondary}
            onClick={() => goTo(activeIndex + 1)}
          >
            Следующее упражнение
            <Icon name="chevron-right" size={18} />
          </button>
        )}
      </footer>
    </div>
  );
}
