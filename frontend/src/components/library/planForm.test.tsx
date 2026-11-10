import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPlanExercise, createPlan } from "../../api/plans";
import { listMyExercises } from "../../api/exercises";
import type { Exercise } from "../../types/exercise";
import type { Plan } from "../../types/plan";
import { PlanForm } from "./PlanForm";

vi.mock("../../api/plans", () => ({ createPlan: vi.fn(), updatePlan: vi.fn(), addPlanExercise: vi.fn() }));
vi.mock("../../api/exercises", () => ({ listMyExercises: vi.fn() }));
vi.mock("../../api/ai", () => ({ createTrainingPlanDraft: vi.fn() }));

const squat = { id: "e1", name: "Присед", sets: 3, reps: 10, durationSeconds: null, restSeconds: 60 } as Exercise;
const run = { id: "e2", name: "Бег", sets: null, reps: null, durationSeconds: 600, restSeconds: null } as Exercise;
const onSaved = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMyExercises).mockResolvedValue([squat, run]);
  vi.mocked(createPlan).mockResolvedValue({ id: "p1" } as Plan);
  vi.mocked(addPlanExercise).mockResolvedValue({} as never);
});
afterEach(cleanup);

describe("creating a plan", () => {
  it("offers every part of the training right away and saves the picked exercises with the plan", async () => {
    render(<PlanForm token="t" onSaved={onSaved} onCancel={() => {}} />);

    for (const part of ["Разминка", "Основная часть", "Игровая часть", "Заминка"]) expect(screen.getByText(part)).toBeTruthy();
    const warmup = await screen.findByRole("combobox", { name: "Добавить упражнение: Разминка" });
    fireEvent.change(warmup, { target: { value: "e2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Добавить упражнение: Основная часть" }), { target: { value: "e1" } });

    fireEvent.change(screen.getByRole("combobox", { name: /Вид спорта/ }), { target: { value: "Футбол" } });
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: "План" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать план" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(addPlanExercise).toHaveBeenCalledTimes(2);
    expect(addPlanExercise).toHaveBeenCalledWith("t", "p1", expect.objectContaining({ exercise_id: "e2", section: "warmup", order_index: 0, duration_seconds: 600 }));
    expect(addPlanExercise).toHaveBeenCalledWith("t", "p1", expect.objectContaining({ exercise_id: "e1", section: "main", sets: 3, reps: 10, rest_seconds: 60 }));
  });
});
