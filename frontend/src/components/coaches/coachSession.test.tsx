import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeBookingSession, reviewPlayer } from "../../api/bookings";
import type { Booking } from "../../types/booking";
import { CoachSessionActions } from "./CoachSessionActions";

vi.mock("../../api/bookings", () => ({ completeBookingSession: vi.fn(), reviewPlayer: vi.fn() }));

const completeMock = vi.mocked(completeBookingSession);
const reviewMock = vi.mocked(reviewPlayer);

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    coachUserId: "c1",
    coachFullName: "Тренер",
    listingId: null,
    listingTitle: null,
    athleteUserId: "a1",
    athleteFullName: "Игорь",
    athleteNotes: null,
    startsAt: new Date(Date.now() - 10 * 60_000).toISOString(), // started 10 minutes ago
    durationMinutes: 60,
    format: "online",
    pricePerSession: null,
    currency: "RUB",
    status: "confirmed",
    isCompleted: false,
    trainingId: "t1",
    trainingPlanId: null,
    trainingPlanName: null,
    trainingStatus: "scheduled",
    hasReview: false,
    hasPlayerReview: false,
    ...overrides,
  };
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  completeMock.mockReset();
  reviewMock.mockReset();
  reviewMock.mockResolvedValue();
});
afterEach(cleanup);

describe("coach session actions", () => {
  it("offers «Тренировка проведена» once the session has started", () => {
    render(<CoachSessionActions token="t" booking={makeBooking()} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Тренировка проведена" })).not.toBeNull();
  });

  it("explains that the button appears later when the session hasn't started", () => {
    const future = makeBooking({ startsAt: new Date(Date.now() + 3600_000).toISOString() });
    render(<CoachSessionActions token="t" booking={future} onChange={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Тренировка проведена" })).toBeNull();
    expect(screen.getByText(/появится, когда занятие начнётся/)).not.toBeNull();
  });

  it("pressing it saves, then immediately asks for the player review window", async () => {
    const done = makeBooking({ trainingStatus: "completed", isCompleted: true });
    completeMock.mockResolvedValue(done);
    const onChange = vi.fn();
    render(<CoachSessionActions token="t" booking={makeBooking()} onChange={onChange} />);

    click("Тренировка проведена");
    await act(async () => {});

    expect(completeMock).toHaveBeenCalledWith("t", "b1");
    expect(onChange).toHaveBeenCalledWith(done);
    expect(screen.getByRole("dialog", { name: "Поставьте отзыв: Игорь" })).not.toBeNull();
  });

  it("the review can be postponed or sent with stars and a text", async () => {
    const done = makeBooking({ trainingStatus: "completed", isCompleted: true });
    completeMock.mockResolvedValue(done);
    const onChange = vi.fn();
    render(<CoachSessionActions token="t" booking={makeBooking()} onChange={onChange} />);
    click("Тренировка проведена");
    await act(async () => {});

    click("Позже");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reviewMock).not.toHaveBeenCalled();

    cleanup();
    render(<CoachSessionActions token="t" booking={done} onChange={onChange} />);
    click("Оставить отзыв об игроке");
    fireEvent.click(screen.getByRole("button", { name: "2 из 5" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Опоздал  " } });
    click("Отправить отзыв");
    await act(async () => {});

    expect(reviewMock).toHaveBeenCalledWith("t", "b1", { rating: 2, text: "Опоздал" });
    expect(onChange).toHaveBeenLastCalledWith({ ...done, hasPlayerReview: true, isCompleted: true });
  });

  it("after the review is left there is nothing more to do", () => {
    const reviewed = makeBooking({ trainingStatus: "completed", isCompleted: true, hasPlayerReview: true });
    render(<CoachSessionActions token="t" booking={reviewed} onChange={vi.fn()} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Вы оставили отзыв об игроке/)).not.toBeNull();
  });

  it("renders nothing for a booking that isn't confirmed", () => {
    const { container } = render(<CoachSessionActions token="t" booking={makeBooking({ status: "declined" })} onChange={vi.fn()} />);

    expect(container.textContent).toBe("");
  });
});
