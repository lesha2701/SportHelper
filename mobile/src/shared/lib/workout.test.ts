import { describe, expect, it } from "@jest/globals";
import {
  buildWorkoutExercises,
  describePlan,
  describeSets,
  detectMetric,
  formatClock,
  formatMeters,
  meterStep,
  parseClock,
  parseExerciseTarget,
  workoutTotals,
} from "./workout";
import type { WorkoutExercise } from "@/shared/types/training";

describe("reading a planned exercise", () => {
  it("takes the name and the plan with its units from the line written by the training form", () => {
    expect(parseExerciseTarget("Приседания — 3 подх. x 15 повт.")).toMatchObject({ name: "Приседания", metric: "reps", sets: 3, reps: 15 });
    expect(parseExerciseTarget("Планка — 3 подх. x 45 сек")).toMatchObject({ name: "Планка", metric: "time", sets: 3, seconds: 45 });
    expect(parseExerciseTarget("Бег — 3 подх. x 1000 м x 300 сек")).toMatchObject({ metric: "distance", sets: 3, meters: 1000, seconds: 300 });
    expect(parseExerciseTarget("Бег — 5 км")).toMatchObject({ metric: "distance", meters: 5000, sets: null, seconds: null });
  });

  it("keeps a line that names the exercise, or only its sets, without a kind", () => {
    expect(parseExerciseTarget("Бег на месте")).toMatchObject({ name: "Бег на месте", metric: null });
    expect(parseExerciseTarget("Планка — 4 подх.")).toMatchObject({ name: "Планка", metric: null, sets: 4 });
    expect(parseExerciseTarget("Что-то — странное")).toMatchObject({ name: "Что-то — странное", metric: null, sets: null });
  });
});

describe("how an exercise is measured when the line does not say", () => {
  it("counts strength exercises in repetitions and everything unknown too", () => {
    for (const name of ["Приседания", "Отжимания", "Подтягивания", "Жим лёжа", "Что-то своё"]) {
      expect(detectMetric(name).metric).toBe("reps");
    }
  });

  it("counts static and timed exercises in time", () => {
    for (const name of ["Планка", "Растяжка", "Прыжки на скакалке", "Бег на месте", "Вис на турнике", "Разминка"]) {
      expect(detectMetric(name).metric).toBe("time");
    }
  });

  it("counts runs, swims and jumps for distance", () => {
    for (const name of ["Бег в длину", "Бег", "Пробежка", "Плавание", "Прыжок в длину", "Ходьба"]) {
      expect(detectMetric(name).metric).toBe("distance");
    }
  });
});

describe("the workout built from the plan", () => {
  it("uses the units the form wrote, and fills what is missing with sensible numbers", () => {
    const [squats, plank, run, jump] = buildWorkoutExercises([
      { text: "Приседания — 2 подх. x 15 повт." },
      { text: "Планка — 3 подх. x 45 сек" },
      { text: "Бег — 5 км x 1500 сек" },
      { text: "Прыжок в длину" },
    ]);

    expect(squats!.sets).toEqual([
      { reps: 15, weightKg: null, seconds: null, meters: null, done: false },
      { reps: 15, weightKg: null, seconds: null, meters: null, done: false },
    ]);
    expect(plank).toMatchObject({ metric: "time", targetSeconds: 45 });
    expect(plank!.sets).toHaveLength(3);
    expect(plank!.sets[0]).toMatchObject({ reps: 0, seconds: 45 });
    expect(run).toMatchObject({ metric: "distance", targetMeters: 5000, targetSeconds: 1500 });
    expect(run!.sets).toEqual([{ reps: 0, weightKg: null, seconds: 1500, meters: 5000, done: false }]);
    expect(jump!.metric).toBe("distance");
    expect(jump!.sets).toHaveLength(3);
    expect(jump!.sets[0]).toMatchObject({ meters: 2, seconds: null });
  });

  it("falls back to the name for old descriptions", () => {
    const [plank, run] = buildWorkoutExercises([{ text: "Планка — 4 подх." }, { text: "Бег в длину" }]);

    expect(plank).toMatchObject({ metric: "time", targetSets: 4 });
    expect(plank!.sets[0]).toMatchObject({ seconds: 30 });
    expect(run).toMatchObject({ metric: "distance" });
    expect(run!.sets).toHaveLength(1);
  });

  it("steps a distance by the size of it", () => {
    expect(meterStep({ targetMeters: 3, sets: [] })).toBe(0.1);
    expect(meterStep({ targetMeters: 100, sets: [] })).toBe(5);
    expect(meterStep({ targetMeters: 5000, sets: [] })).toBe(100);
  });
});

describe("workout results", () => {
  const plan = { targetSets: null, targetReps: null, targetSeconds: null, targetMeters: null };
  const exercises: WorkoutExercise[] = [
    {
      name: "Присед",
      metric: "reps",
      ...plan,
      targetSets: 3,
      targetReps: 15,
      sets: [
        { reps: 15, weightKg: 20, seconds: null, meters: null, done: true },
        { reps: 14, weightKg: 20, seconds: null, meters: null, done: true },
        { reps: 15, weightKg: null, seconds: null, meters: null, done: false },
      ],
    },
    { name: "Планка", metric: "time", ...plan, sets: [{ reps: 0, weightKg: null, seconds: 45, meters: null, done: true }] },
    { name: "Бег", metric: "distance", ...plan, sets: [{ reps: 0, weightKg: null, seconds: 750, meters: 1500, done: true }] },
  ];

  it("adds up each kind of work separately, only for the sets that were done", () => {
    expect(workoutTotals(exercises)).toEqual({ setsDone: 4, setsTotal: 5, reps: 29, volumeKg: 580, exercisesDone: 2, seconds: 45, meters: 1500 });
  });

  it("describes the done sets of each kind in one line", () => {
    expect(describeSets(exercises[0]!)).toBe("15 × 20 кг, 14 × 20 кг");
    expect(describeSets(exercises[1]!)).toBe("0:45");
    expect(describeSets(exercises[2]!)).toBe("1,5 км за 12:30");
  });

  it("describes the plan of each kind", () => {
    expect(describePlan({ metric: "reps", targetSets: 3, targetReps: 15, targetSeconds: null, targetMeters: null })).toBe("3 подх. × 15 повт.");
    expect(describePlan({ metric: "time", targetSets: 3, targetReps: null, targetSeconds: 45, targetMeters: null })).toBe("3 подх. × 0:45");
    expect(describePlan({ metric: "distance", targetSets: null, targetReps: null, targetSeconds: 900, targetMeters: 3000 })).toBe("3 км за 15:00");
  });

  it("formats and reads clocks and distances", () => {
    expect(formatClock(83)).toBe("1:23");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-4)).toBe("0:00");
    expect(parseClock("12:30")).toBe(750);
    expect(parseClock("45")).toBe(45);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(formatMeters(800)).toBe("800 м");
    expect(formatMeters(2.5)).toBe("2,5 м");
    expect(formatMeters(12000)).toBe("12 км");
  });
});
