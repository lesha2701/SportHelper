import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMyBookings } from "../../api/bookings";
import type { Booking } from "../../types/booking";
import type { Training } from "../../types/training";
import { TrainingForm } from "./TrainingForm";

vi.mock("../../api/bookings", () => ({ listMyBookings: vi.fn() }));
vi.mock("../../api/trainings", () => ({ createPersonalTraining: vi.fn(), createTeamTraining: vi.fn(), deleteTraining: vi.fn(), updateTraining: vi.fn() }));
vi.mock("../../api/plans", () => ({ listMyPlans: vi.fn() }));
vi.mock("../../api/teams", () => ({ listMembers: vi.fn() }));
vi.mock("../../api/ai", () => ({ createPersonalTrainingDraft: vi.fn() }));

const listMock = vi.mocked(listMyBookings);

const training: Training = {
  id: "t1", teamId: null, createdBy: "me", type: "personal", planId: null, trainingDate: "2030-01-10", startTime: "18:00:00",
  durationMinutes: 60, location: "Корт 3", description: "Заметка", status: "scheduled", reminderMinutesBefore: 60,
  recurrenceGroupId: null, responsibleUserId: null,
};

function booking(overrides: Partial<Booking> = {}): Booking {
  return { id: "b1", coachFullName: "Алексей Морозов", status: "confirmed", trainingId: "t1", ...overrides } as Booking;
}

async function openEdit() {
  render(<TrainingForm token="t" mode="personal" initial={training} onSaved={vi.fn()} onCancel={vi.fn()} onDeleted={vi.fn()} />);
  await act(async () => {});
}

beforeEach(() => listMock.mockReset());
afterEach(cleanup);

describe("editing a session booked with a coach", () => {
  it("shows the coach, locks date, time, length, place and description, and offers no «Удалить»", async () => {
    listMock.mockResolvedValue([booking({ id: "other", trainingId: "elsewhere" }), booking()]);
    await openEdit();

    expect(screen.getByRole("note").textContent).toContain("Алексей Морозов");
    for (const label of ["Дата", "Время", "Длительность, мин", "Место", "Описание"]) {
      const field = screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
      expect(field.disabled, `${label} should be read-only`).toBe(true);
    }
    expect(screen.queryByRole("button", { name: "Удалить тренировку" })).toBeNull();
    // the reminder stays the athlete's own
    expect((screen.getByLabelText("Напоминать об этой тренировке") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves the athlete's own personal training fully editable and deletable", async () => {
    listMock.mockResolvedValue([booking({ trainingId: "another-training" })]);
    await openEdit();

    expect(screen.queryByRole("note")).toBeNull();
    for (const label of ["Дата", "Время", "Длительность, мин", "Место", "Описание"]) {
      expect((screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement).disabled).toBe(false);
    }
    expect(screen.getByRole("button", { name: "Удалить тренировку" })).not.toBeNull();
  });
});
