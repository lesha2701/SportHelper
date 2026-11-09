import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMyExercises, listTeamExercises, shareExercise } from "../../api/exercises";
import { listMyPlans, listTeamPlans } from "../../api/plans";
import type { Exercise } from "../../types/exercise";
import { TeamLibraryTab } from "./TeamLibraryTab";

vi.mock("../../api/exercises", () => ({ listTeamExercises: vi.fn(), listMyExercises: vi.fn(), shareExercise: vi.fn(), unshareExercise: vi.fn() }));
vi.mock("../../api/plans", () => ({ listTeamPlans: vi.fn(), listMyPlans: vi.fn(), sharePlan: vi.fn(), unsharePlan: vi.fn() }));
vi.mock("../library/ExerciseDetail", () => ({ ExerciseDetail: () => null }));
vi.mock("../library/PlanDetail", () => ({ PlanDetail: () => null }));

const squat = { id: "e1", name: "Присед", sport: "Футбол", sharedTeamIds: [] } as unknown as Exercise;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTeamExercises).mockResolvedValue([]);
  vi.mocked(listTeamPlans).mockResolvedValue([]);
  vi.mocked(listMyExercises).mockResolvedValue([squat]);
  vi.mocked(listMyPlans).mockResolvedValue([]);
  vi.mocked(shareExercise).mockResolvedValue({ ...squat, sharedTeamIds: ["t1"] } as unknown as Exercise);
});
afterEach(cleanup);

describe("«Упражнения и планы» of a team", () => {
  it("tells a player what is going on and gives no buttons", async () => {
    render(<TeamLibraryTab token="t" teamId="t1" teamName="Ястребы" canManage={false} />);
    await screen.findByText("Тренер ещё не открыл команде ни одного упражнения.");
    expect(screen.queryByRole("button", { name: /Открыть команде/ })).toBeNull();
  });

  it("tells a coach what to press, and the button opens the coach's own exercises with a switch each", async () => {
    render(<TeamLibraryTab token="t" teamId="t1" teamName="Ястребы" canManage />);
    await screen.findByText(/Откройте команде свои упражнения кнопкой выше/);

    fireEvent.click(screen.getByRole("button", { name: /Открыть команде упражнения/ }));
    const box = await screen.findByRole("checkbox", { name: "Присед" });
    fireEvent.click(box);

    await waitFor(() => expect(shareExercise).toHaveBeenCalledWith("t", "e1", "t1"));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Присед" }) as HTMLInputElement).checked).toBe(true));
  });
});
