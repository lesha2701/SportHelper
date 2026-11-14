import { describe, expect, it } from "vitest";
import { rowsWithoutName, type NamedRow } from "./exerciseNames";

const row = (key: string, patch: Partial<NamedRow> = {}): NamedRow => ({
  key,
  exercise: "",
  reps: "",
  sets: "",
  durationSeconds: "",
  distanceMeters: "",
  timeMinutes: "",
  ...patch,
});

describe("rowsWithoutName", () => {
  it("lets the untouched first row through (a training without exercises)", () => {
    expect(rowsWithoutName([row("a")])).toEqual([]);
  });

  it("flags a single row that has numbers but no name", () => {
    expect(rowsWithoutName([row("a", { reps: "10" })])).toEqual(["a"]);
    expect(rowsWithoutName([row("a", { distanceMeters: "5000" })])).toEqual(["a"]);
  });

  it("flags every empty row when there are several, and only those", () => {
    expect(rowsWithoutName([row("a", { exercise: "Приседания" }), row("b"), row("c", { exercise: "  " })])).toEqual(["b", "c"]);
  });

  it("accepts a list where every exercise has a name", () => {
    expect(rowsWithoutName([row("a", { exercise: "Приседания" }), row("b", { exercise: "Планка", durationSeconds: "60" })])).toEqual([]);
  });
});
