import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmBooking, declineBooking, listCoachPendingBookings, listMyBookings } from "../../api/bookings";
import { dismissToast, subscribeToasts, toast, type ToastItem } from "../../toast";
import type { Booking, PendingBooking } from "../../types/booking";
import { notificationToOverlay } from "../../overlay";
import { ToastHost } from "../shared/ToastHost";
import { IncomingBookingsScreen } from "./IncomingBookingsScreen";
import { MyBookingsSection } from "./MyBookingsSection";

vi.mock("../../api/bookings", () => ({
  confirmBooking: vi.fn(),
  declineBooking: vi.fn(),
  listCoachPendingBookings: vi.fn(),
  listMyBookings: vi.fn(),
  reviewBooking: vi.fn(),
}));
// The training screen itself is not under test; a marker proves where the user lands.
vi.mock("../trainings/TrainingDetail", () => ({
  TrainingDetail: ({ trainingId }: { trainingId: string }) => <div>TRAINING SCREEN {trainingId}</div>,
}));

const pending = (id: string, name = "Игорь"): PendingBooking => ({
  id,
  listingTitle: "Тренировки",
  athleteUserId: `a-${id}`,
  athleteFullName: name,
  athleteNotes: null,
  startsAt: "2026-10-12T10:00:00Z",
  durationMinutes: 60,
  format: "online",
  pricePerSession: null,
  currency: "RUB",
  createdAt: "2026-10-06T10:00:00Z",
  athleteRatingAverage: null,
  athleteReviewCount: 0,
});

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "b1",
  coachUserId: "c1",
  coachFullName: "Тренер Анна",
  listingId: null,
  listingTitle: null,
  athleteUserId: "a1",
  athleteFullName: "Игорь",
  athleteNotes: null,
  startsAt: "2026-10-12T10:00:00Z",
  durationMinutes: 60,
  format: "online",
  pricePerSession: null,
  currency: "RUB",
  status: "confirmed",
  isCompleted: false,
  trainingId: "t-77",
  trainingPlanId: null,
  trainingPlanName: null,
  trainingStatus: "scheduled",
  hasReview: false,
  hasPlayerReview: false,
  ...overrides,
});

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const flush = () => act(async () => {});

beforeEach(() => {
  // jsdom has no layout, hence no scrollIntoView (the real browser does).
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(confirmBooking).mockReset();
  vi.mocked(declineBooking).mockReset();
  vi.mocked(listCoachPendingBookings).mockReset();
  vi.mocked(listMyBookings).mockReset();
});
afterEach(() => {
  cleanup();
  let current: ToastItem[] = [];
  subscribeToasts((t) => (current = t))();
  current.forEach((t) => dismissToast(t.id));
});

describe("toast with a next-step action", () => {
  it("shows the action, runs it on click and dismisses the toast", async () => {
    const run = vi.fn();
    render(<ToastHost />);

    act(() => toast.success("Матч создан", { label: "Посмотреть в календаре", onClick: run }));
    click("Посмотреть в календаре");

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Матч создан")).toBeNull();
  });
});

describe("coach: incoming booking requests", () => {
  it("after confirming, offers the training that was just created (using the id from the response)", async () => {
    vi.mocked(listCoachPendingBookings).mockResolvedValue([pending("b1"), pending("b2", "Олег")]);
    vi.mocked(confirmBooking).mockResolvedValue(booking({ id: "b1", trainingId: "t-77" }));
    render(<IncomingBookingsScreen token="t" onBack={() => {}} />);
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Подтвердить" })[0]!);
    await flush();

    expect(screen.getByText("Заявка подтверждена")).not.toBeNull();
    click("Открыть тренировку");
    expect(screen.getByText("TRAINING SCREEN t-77")).not.toBeNull();
  });

  it("after declining, the next step is the request list", async () => {
    vi.mocked(listCoachPendingBookings).mockResolvedValue([pending("b1"), pending("b2", "Олег")]);
    vi.mocked(declineBooking).mockResolvedValue(booking({ status: "declined", trainingId: null }));
    render(<IncomingBookingsScreen token="t" onBack={() => {}} />);
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Отклонить" })[0]!);
    await flush();

    expect(screen.getByText("Заявка отклонена")).not.toBeNull();
    click("К списку заявок");
    expect(screen.queryByText("Заявка отклонена")).toBeNull();
    expect(screen.getByText("Олег")).not.toBeNull(); // the other request is still there
  });

  it("opened from a notification, says so when that request was already handled", async () => {
    vi.mocked(listCoachPendingBookings).mockResolvedValue([pending("b2", "Олег")]);
    render(<IncomingBookingsScreen token="t" onBack={() => {}} focusBookingId="gone" />);
    await flush();

    expect(screen.getByText(/уже обработана/)).not.toBeNull();
  });
});

describe("player: «Мои брони» opened from a status notification", () => {
  it("a confirmed booking opens its training right away", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking({ id: "b1", trainingId: "t-77" })]);
    render(<MyBookingsSection token="t" onBack={() => {}} focusBookingId="b1" />);
    await flush();

    expect(screen.getByText("TRAINING SCREEN t-77")).not.toBeNull();
  });

  it("a declined booking stays in the list instead", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking({ id: "b1", status: "declined", trainingId: null })]);
    render(<MyBookingsSection token="t" onBack={() => {}} focusBookingId="b1" />);
    await flush();

    expect(screen.queryByText(/TRAINING SCREEN/)).toBeNull();
    expect(screen.getByText("Отклонена тренером")).not.toBeNull();
  });

  it("with no upcoming bookings the next step is finding a coach", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([]);
    render(<MyBookingsSection token="t" onBack={() => {}} />);
    await flush();

    expect(screen.getByRole("button", { name: "Найти тренера" })).not.toBeNull();
  });
});

describe("notification deep links point at the concrete object", () => {
  it("maps every actionable category to its entity, not to a general list", () => {
    expect(notificationToOverlay("booking_requested", "b9")).toEqual({ kind: "incoming-bookings", focusBookingId: "b9" });
    expect(notificationToOverlay("booking_decided", "b9")).toEqual({ kind: "my-bookings", focusBookingId: "b9" });
    expect(notificationToOverlay("review_requested", "b9")).toEqual({ kind: "my-bookings", reviewBookingId: "b9" });
    expect(notificationToOverlay("new_task", "k1")).toEqual({ kind: "task-detail", taskId: "k1" });
    expect(notificationToOverlay("task_deadline", "k1")).toEqual({ kind: "task-detail", taskId: "k1" });
    expect(notificationToOverlay("new_match", "m1")).toEqual({ kind: "match-detail", matchId: "m1" });
    expect(notificationToOverlay("new_training", "t1")).toEqual({ kind: "training-detail", trainingId: "t1" });
    expect(notificationToOverlay("training_reminder", "t1")).toEqual({ kind: "training-detail", trainingId: "t1" });
    expect(notificationToOverlay("training_nudge", "u1")).toEqual({ kind: "training-create" });
  });
});
