import type { WorkoutExercise, WorkoutMetric, WorkoutSet } from "../types/training";

export interface ExerciseTarget {
  name: string;
  /** What the line says the exercise is measured in; null when it only names the exercise (or only its sets). */
  metric: WorkoutMetric | null;
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
}

const NO_TARGET = { metric: null, sets: null, reps: null, seconds: null, meters: null } as const;

/** One piece of the plan of an exercise, as the training form writes it: "3 подх.", "15 повт.", "45 сек", "3000 м". */
function readToken(token: string, target: ExerciseTarget): boolean {
  let m: RegExpMatchArray | null;
  if ((m = token.match(/^(\d+) подх\.$/))) target.sets = Number(m[1]);
  else if ((m = token.match(/^(\d+) повт\.$/))) target.reps = Number(m[1]);
  else if ((m = token.match(/^(\d+) сек$/))) target.seconds = Number(m[1]);
  else if ((m = token.match(/^(\d+(?:[.,]\d+)?) (м|км)$/))) target.meters = Math.round(Number(m[1]!.replace(",", ".")) * (m[2] === "км" ? 1000 : 1) * 10) / 10;
  else return false;
  return true;
}

/** "Приседания — 3 подх. x 15 повт." / "Планка — 3 подх. x 45 сек" / "Бег — 3000 м x 900 сек" -> the name and the plan.
 * A line that is only a name, or whose tail is not understood, is just a name. */
export function parseExerciseTarget(text: string): ExerciseTarget {
  const match = text.match(/^(.*?) — (.+)$/);
  if (!match) return { name: text.trim(), ...NO_TARGET };
  const target: ExerciseTarget = { name: (match[1] ?? text).trim(), ...NO_TARGET };
  for (const token of (match[2] ?? "").split(/\s+x\s+/)) {
    if (!readToken(token.trim(), target)) return { name: text.trim(), ...NO_TARGET };
  }
  if (target.meters !== null) target.metric = "distance";
  else if (target.seconds !== null) target.metric = "time";
  else if (target.reps !== null) target.metric = "reps";
  return target;
}

/** How a kind of exercise is counted when the description does not say, and what a fresh set of it starts from. */
export interface MetricProfile {
  metric: WorkoutMetric;
  defaultSets: number;
  /** Starting value of a set: repetitions, seconds or meters, depending on the metric. */
  defaultValue: number;
}

const REPS: MetricProfile = { metric: "reps", defaultSets: 3, defaultValue: 10 };

// The first matching rule wins, so the specific ones ("бег на месте") stand before the general ones ("бег").
const RULES: { test: RegExp; profile: MetricProfile }[] = [
  { test: /скакалк/, profile: { metric: "time", defaultSets: 3, defaultValue: 60 } },
  { test: /на месте|планк|растяжк|стойк|удержан|статик|(^|\s)вис($|\s)|йога|разминк|заминк|кардио|медитац|дыхани/, profile: { metric: "time", defaultSets: 3, defaultValue: 30 } },
  { test: /(^|\s)(бег|пробеж|кросс|спринт|ходьб|плаван|заплыв|велосипед|велотрен|лыж|гребл|марафон)/, profile: { metric: "distance", defaultSets: 1, defaultValue: 1000 } },
  { test: /прыж\S* в длину|в длину|прыж\S* в высоту|в высоту|метани|толкани/, profile: { metric: "distance", defaultSets: 3, defaultValue: 2 } },
];

export function profileFor(metric: WorkoutMetric): MetricProfile {
  switch (metric) {
    case "time":
      return { metric, defaultSets: 3, defaultValue: 30 };
    case "distance":
      return { metric, defaultSets: 1, defaultValue: 1000 };
    default:
      return REPS;
  }
}

/** Guesses from the name how an exercise is measured (for descriptions without units and for the form's suggestion);
 * anything unknown is repetitions. */
export function detectMetric(name: string): MetricProfile {
  const lower = name.toLowerCase();
  return RULES.find((rule) => rule.test.test(lower))?.profile ?? REPS;
}

export function newSet(metric: WorkoutMetric, value: { reps?: number | null; seconds?: number | null; meters?: number | null } = {}): WorkoutSet {
  const profile = profileFor(metric);
  return {
    reps: metric === "reps" ? (value.reps ?? profile.defaultValue) : 0,
    weightKg: null,
    seconds: metric === "time" ? (value.seconds ?? profile.defaultValue) : metric === "distance" ? (value.seconds ?? null) : null,
    meters: metric === "distance" ? (value.meters ?? profile.defaultValue) : null,
    done: false,
  };
}

export function buildWorkoutExercises(items: { text: string }[]): WorkoutExercise[] {
  return items.map((item) => {
    const target = parseExerciseTarget(item.text);
    const guessed = detectMetric(target.name);
    const metric = target.metric ?? guessed.metric;
    const profile = profileFor(metric);
    // A line that only names the exercise keeps the starting numbers of the kind the name suggests.
    const sets = target.sets ?? (metric === guessed.metric ? guessed.defaultSets : profile.defaultSets);
    const value = metric === guessed.metric ? guessed.defaultValue : profile.defaultValue;
    return {
      name: target.name,
      metric,
      targetSets: target.sets,
      targetReps: metric === "reps" ? target.reps : null,
      targetSeconds: metric === "reps" ? null : target.seconds,
      targetMeters: metric === "distance" ? target.meters : null,
      sets: Array.from({ length: sets }, () =>
        newSet(metric, { reps: target.reps ?? value, seconds: target.seconds ?? (metric === "time" ? value : null), meters: target.meters ?? value }),
      ),
    };
  });
}

/** One tap of + / - on a distance, by the size of the distance: a jump is counted in tenths of a meter, a run in hundreds. */
export function meterStep(exercise: Pick<WorkoutExercise, "targetMeters" | "sets">): number {
  const reference = exercise.targetMeters ?? exercise.sets[0]?.meters ?? 1000;
  if (reference < 20) return 0.1;
  if (reference < 200) return 5;
  return 100;
}

export interface WorkoutTotals {
  setsDone: number;
  setsTotal: number;
  reps: number;
  /** Sum of reps x weight over the sets that have a weight, in kilograms. */
  volumeKg: number;
  exercisesDone: number;
  /** Time under load in the exercises measured in time. */
  seconds: number;
  meters: number;
}

export function workoutTotals(exercises: WorkoutExercise[]): WorkoutTotals {
  let setsDone = 0;
  let setsTotal = 0;
  let reps = 0;
  let volumeKg = 0;
  let exercisesDone = 0;
  let seconds = 0;
  let meters = 0;
  for (const exercise of exercises) {
    setsTotal += exercise.sets.length;
    const done = exercise.sets.filter((s) => s.done);
    setsDone += done.length;
    if (exercise.sets.length > 0 && done.length === exercise.sets.length) exercisesDone += 1;
    for (const set of done) {
      if (exercise.metric === "time") seconds += set.seconds ?? 0;
      else if (exercise.metric === "distance") meters += set.meters ?? 0;
      else {
        reps += set.reps;
        if (set.weightKg) volumeKg += set.reps * set.weightKg;
      }
    }
  }
  return {
    setsDone,
    setsTotal,
    reps,
    volumeKg: Math.round(volumeKg * 10) / 10,
    exercisesDone,
    seconds,
    meters: Math.round(meters * 10) / 10,
  };
}

export function formatKg(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1).replace(".", ",")} кг`;
}

/** 83 -> "1:23", 3725 -> "1:02:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "12:30" or "750" (seconds) -> seconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** 1500 -> "1,5 км", 800 -> "800 м", 2.5 -> "2,5 м" */
export function formatMeters(meters: number): string {
  if (meters >= 1000) {
    const km = Math.round(meters / 100) / 10;
    return `${String(km).replace(".", ",")} км`;
  }
  const rounded = Math.round(meters * 10) / 10;
  return `${String(rounded).replace(".", ",")} м`;
}

/** The plan of an exercise in one line: "3 подх. × 15 повт.", "3 подх. × 0:45", "3 км за 15:00". */
export function describePlan(exercise: Pick<WorkoutExercise, "metric" | "targetSets" | "targetReps" | "targetSeconds" | "targetMeters">): string {
  const sets = exercise.targetSets ? `${exercise.targetSets} подх.` : null;
  if (exercise.metric === "time") return [sets, exercise.targetSeconds ? formatClock(exercise.targetSeconds) : null].filter(Boolean).join(" × ");
  if (exercise.metric === "distance") {
    const distance = exercise.targetMeters ? formatMeters(exercise.targetMeters) : null;
    const time = exercise.targetSeconds ? `за ${formatClock(exercise.targetSeconds)}` : null;
    return [sets, [distance, time].filter(Boolean).join(" ")].filter(Boolean).join(" × ");
  }
  return [sets, exercise.targetReps ? `${exercise.targetReps} повт.` : null].filter(Boolean).join(" × ");
}

/** The done sets of one exercise in one line: "15 × 20 кг, 14 × 20 кг", "0:45, 0:40" or "1,5 км за 12:30". */
export function describeSets(exercise: Pick<WorkoutExercise, "metric" | "sets">): string {
  return exercise.sets
    .filter((s) => s.done)
    .map((s) => {
      if (exercise.metric === "time") return formatClock(s.seconds ?? 0);
      if (exercise.metric === "distance") return `${formatMeters(s.meters ?? 0)}${s.seconds ? ` за ${formatClock(s.seconds)}` : ""}`;
      return s.weightKg ? `${s.reps} × ${formatKg(s.weightKg)}` : String(s.reps);
    })
    .join(", ");
}
