import { describe, expect, it } from "@jest/globals";
import { buildWorkoutExercises } from "./workout";
import { buildPersonalDescription, newRow, parseExerciseChecklist, rowsFromChecklist } from "./trainingDescription";

describe("personal training description", () => {
  it("writes numbered exercises with their plan and the notes", () => {
    const squat = { ...newRow(), exercise: "Приседания", sets: "4", reps: "12" };
    const plank = { ...newRow(), exercise: "Планка", kind: "time" as const, sets: "3", durationSeconds: "45" };
    const run = { ...newRow(), exercise: "Бег", kind: "distance" as const, sets: "1", distanceMeters: "3000", timeMinutes: "15" };
    const text = buildPersonalDescription([squat, plank, run, newRow()], "  Разогреться  ");
    expect(text).toBe(
      "1. Приседания — 4 подх. x 12 повт.\n2. Планка — 3 подх. x 45 сек\n3. Бег — 3000 м x 900 сек\n\nПометки: Разогреться",
    );
  });

  it("reads it back, and the workout is built from the plan it states", () => {
    const squat = { ...newRow(), exercise: "Приседания", sets: "4", reps: "12" };
    const parsed = parseExerciseChecklist(buildPersonalDescription([squat], "Не торопиться"))!;
    expect(parsed.notes).toBe("Не торопиться");
    const exercises = buildWorkoutExercises(parsed.items);
    expect(exercises[0]).toMatchObject({ name: "Приседания", metric: "reps", targetSets: 4, targetReps: 12 });
    expect(exercises[0]!.sets).toHaveLength(4);
  });

  it("opens a saved list for editing and writes it back unchanged", () => {
    const squat = { ...newRow(), exercise: "Приседания", sets: "4", reps: "12" };
    const plank = { ...newRow(), exercise: "Планка", kind: "time" as const, sets: "3", durationSeconds: "45" };
    const run = { ...newRow(), exercise: "Бег", kind: "distance" as const, sets: "1", distanceMeters: "3000", timeMinutes: "15" };
    const text = buildPersonalDescription([squat, plank, run], "Не торопиться");

    const parsed = parseExerciseChecklist(text)!;
    const again = buildPersonalDescription(rowsFromChecklist(parsed.items), parsed.notes ?? "");

    expect(again).toBe(text);
  });

  it("leaves free text and empty descriptions alone", () => {
    expect(parseExerciseChecklist("Сегодня работаем над передачами")).toBeNull();
    expect(parseExerciseChecklist("")).toBeNull();
  });
});
