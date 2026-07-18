import { useEffect, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import type { ParsedExerciseChecklist } from "./TrainingDetail";
import profileStyles from "../profile/profile.module.css";
import styles from "./training.module.css";

const DEFAULT_EXERCISE_SECONDS = 30;

type Step =
  | { kind: "exercise"; text: string; durationSeconds: number; round: number; totalRounds: number; exerciseIndex: number; totalExercises: number }
  | { kind: "rest"; durationSeconds: number; round: number; totalRounds: number }
  | { kind: "manual"; text: string; exerciseIndex: number; totalExercises: number };

function buildSteps(checklist: ParsedExerciseChecklist): Step[] {
  const totalExercises = checklist.items.length;

  if (!checklist.rounds) {
    // Reps-style: no known per-exercise duration, so this is a self-paced
    // step-through rather than a countdown.
    return checklist.items.map((item, index) => ({
      kind: "manual",
      text: item.text,
      exerciseIndex: index,
      totalExercises,
    }));
  }

  const rest = checklist.restSeconds ?? 0;
  const steps: Step[] = [];
  for (let round = 1; round <= checklist.rounds; round++) {
    checklist.items.forEach((item, index) => {
      steps.push({
        kind: "exercise",
        text: item.text,
        durationSeconds: item.durationSeconds ?? DEFAULT_EXERCISE_SECONDS,
        round,
        totalRounds: checklist.rounds!,
        exerciseIndex: index,
        totalExercises,
      });
      const isLastStepOverall = round === checklist.rounds && index === checklist.items.length - 1;
      if (rest > 0 && !isLastStepOverall) {
        steps.push({ kind: "rest", durationSeconds: rest, round, totalRounds: checklist.rounds! });
      }
    });
  }
  return steps;
}

export function TrainingSessionScreen({ checklist, onExit }: { checklist: ParsedExerciseChecklist; onExit: () => void }) {
  const steps = useMemo(() => buildSteps(checklist), [checklist]);
  const [stepIndex, setStepIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const first = steps[0];
    return first && first.kind !== "manual" ? first.durationSeconds : 0;
  });
  const [paused, setPaused] = useState(false);

  const step = steps[stepIndex];

  useEffect(() => {
    const next = steps[stepIndex];
    setSecondsLeft(next && next.kind !== "manual" ? next.durationSeconds : 0);
  }, [stepIndex, steps]);

  useEffect(() => {
    if (!step || step.kind === "manual" || paused) return;
    if (secondsLeft <= 0) {
      const timeout = setTimeout(() => setStepIndex((i) => i + 1), 400);
      return () => clearTimeout(timeout);
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, secondsLeft, paused]);

  if (!step) {
    return (
      <div className={styles.sessionScreen}>
        <div className={styles.sessionDone}>
          <Icon name="check-circle" size={56} />
          <h1 className={profileStyles.pageHeading}>Тренировка завершена!</h1>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onExit}>
            Готово
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sessionScreen}>
      <div className={styles.sessionHeader}>
        <button type="button" className={profileStyles.buttonSecondary} style={{ width: "auto", padding: "8px 14px" }} onClick={onExit}>
          <Icon name="x" size={16} />
          Завершить
        </button>
      </div>

      <div className={styles.sessionBody}>
        {step.kind === "manual" ? (
          <>
            <span className={styles.sessionProgress}>
              Упражнение {step.exerciseIndex + 1} из {step.totalExercises}
            </span>
            <h1 className={styles.sessionExerciseName}>{step.text}</h1>
          </>
        ) : (
          <>
            <span className={styles.sessionProgress}>
              Круг {step.round} из {step.totalRounds}
            </span>
            <span className={step.kind === "rest" ? `${styles.sessionPhaseLabel} ${styles.sessionPhaseLabelRest}` : styles.sessionPhaseLabel}>
              {step.kind === "rest" ? "Отдых" : `Упражнение ${step.exerciseIndex + 1} из ${step.totalExercises}`}
            </span>
            {step.kind === "exercise" && <h1 className={styles.sessionExerciseName}>{step.text}</h1>}
            <div className={step.kind === "rest" ? `${styles.sessionTimer} ${styles.sessionTimerRest}` : styles.sessionTimer}>{secondsLeft}</div>
          </>
        )}
      </div>

      <div className={styles.sessionControls}>
        {step.kind === "manual" ? (
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setStepIndex((i) => i + 1)}>
            Готово, дальше
          </button>
        ) : (
          <>
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setPaused((p) => !p)}>
              {paused ? "Продолжить" : "Пауза"}
            </button>
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setStepIndex((i) => i + 1)}>
              Пропустить
            </button>
          </>
        )}
      </div>
    </div>
  );
}
