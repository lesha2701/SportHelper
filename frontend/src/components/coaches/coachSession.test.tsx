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
    startsAt: "2026-11-16T10:00:00Z",
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
    paymentStatus: "not_required",
    paidAt: null,
    canCancel: false,
    hasStarted: true,
    cancellation: null,
    sessionConfirmation: null,
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
    const future = makeBooking({ hasStarted: false });
    render(<CoachSessionActions token="t" booking={future} onChange={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Тренировка проведена" })).toBeNull();
    expect(screen.getByText(/появится, когда занятие начнётся/)).not.toBeNull();
  });

  it("goes by the server's has_started, never by the device's clock (startsAt is wall-clock time)", () => {
    // 10:00 Moscow is stored as 10:00Z; at 10:30 in Moscow the device's clock reads 07:30Z and would say "not yet".
    const begun = makeBooking({ startsAt: "2999-01-01T10:00:00Z", hasStarted: true });
    const { unmount } = render(<CoachSessionActions token="t" booking={begun} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Тренировка проведена" })).not.toBeNull();
    unmount();

    const ahead = makeBooking({ startsAt: "2000-01-01T10:00:00Z", hasStarted: false });
    render(<CoachSessionActions token="t" booking={ahead} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Тренировка проведена" })).toBeNull();
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
